import { $ownsProject } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure, OwnedResourceProvider } from "alepha/security";
import { $action, BadRequestError, NotFoundError } from "alepha/server";

import { useCaseRunResults } from "../entities/useCaseRunResults.ts";
import { type UseCaseRun, useCaseRuns } from "../entities/useCaseRuns.ts";
import { useCases } from "../entities/useCases.ts";
import { criterionResultSchema } from "../schemas/criterionResultSchema.ts";
import { runBySchema } from "../schemas/runBySchema.ts";
import { useCaseRunResourceSchema } from "../schemas/useCaseRunResourceSchema.ts";
import { RequirementsBuckets } from "../services/RequirementsBuckets.ts";
import { RunService } from "../services/RunService.ts";

/**
 * Runs of a use case (#E153): record one (an agent, the CI or a person
 * played the criteria), read them, and attach evidence to them.
 */
export class RunController {
  protected readonly runs = $repository(useCaseRuns);
  protected readonly results = $repository(useCaseRunResults);
  protected readonly useCases = $repository(useCases);
  protected readonly service = $inject(RunService);
  protected readonly buckets = $inject(RequirementsBuckets);
  protected readonly owned = $inject(OwnedResourceProvider);

  protected ownsProject = (requires: string) =>
    $ownsProject({ requires, param: "projectId" });

  protected ownsProjectForWrite = (requires: string) =>
    $ownsProject({
      requires,
      param: "projectId",
      capability: {
        key: "plan",
        option: "requirements",
        action: "record a run",
      },
    });

  protected ownsRunForWrite = (requires: string) =>
    $ownsProject({
      requires,
      repository: () => this.runs,
      param: "id",
      capability: {
        key: "plan",
        option: "requirements",
        action: "record a run",
      },
    });

  protected ownsRun = (requires: string) =>
    $ownsProject({ requires, repository: () => this.runs, param: "id" });

  recordUseCaseRun = $action({
    method: "POST",
    path: "/recordUseCaseRun/:projectId",
    use: [this.ownsProjectForWrite("usecase:write")],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        useCaseNumber: z.integer(),
        by: runBySchema,
        client: z.string().max(60).optional(),
        app: z.string().max(120).optional(),
        env: z.string().max(120).optional(),
        note: z.string().max(4000).optional(),
        results: z.array(
          z.object({
            key: z.string(),
            result: criterionResultSchema,
            note: z.string().max(2000).optional(),
          }),
        ),
      }),
      response: z.object({
        run: useCaseRunResourceSchema,
        errorsOpened: z.integer(),
        /**
         * What a failure did: `opened` errors, stayed `in_development` (a
         * covering quest is open), or `no_inbox` (Ship's track is off, so
         * the use case shows Failing).
         */
        errorRule: z.enum(["opened", "in_development", "no_inbox", "none"]),
      }),
    },
    handler: async ({ params, body, user }) => {
      const [useCase] = await this.useCases.findMany({
        where: {
          projectId: { eq: params.projectId },
          number: { eq: body.useCaseNumber },
        },
        limit: 1,
      });
      if (!useCase)
        throw new NotFoundError(`Use case #U${body.useCaseNumber} not found`);
      const recorded = await this.service.record({
        useCase,
        by: body.by,
        client: body.client,
        byUserId: user.id,
        app: body.app,
        env: body.env,
        note: body.note,
        results: body.results,
      });
      return {
        run: {
          ...recorded.run,
          results: recorded.results.map((it) => ({
            criterionKey: it.criterionKey,
            result: it.result,
            note: it.note,
          })),
        },
        errorsOpened: recorded.errorsOpened,
        errorRule: recorded.errorRule,
      };
    },
  });

  getUseCaseRuns = $action({
    method: "GET",
    path: "/getUseCaseRuns/:projectId/:number",
    use: [this.ownsProject("usecase:read")],
    schema: {
      params: z.object({ projectId: z.integer(), number: z.integer() }),
      response: z.array(useCaseRunResourceSchema),
    },
    handler: async ({ params }) => {
      const [useCase] = await this.useCases.findMany({
        where: {
          projectId: { eq: params.projectId },
          number: { eq: params.number },
        },
        limit: 1,
      });
      if (!useCase)
        throw new NotFoundError(`Use case #U${params.number} not found`);
      const runs = await this.runs.findMany({
        where: { useCaseId: { eq: useCase.id } },
        orderBy: [{ column: "ranAt", direction: "desc" }],
        limit: 50,
      });
      const rows = runs.length
        ? await this.results.findMany({
            where: { runId: { inArray: runs.map((it) => it.id) } },
          })
        : [];
      return runs.map((run) => ({
        ...run,
        results: rows
          .filter((it) => it.runId === run.id)
          .map((it) => ({
            criterionKey: it.criterionKey,
            result: it.result,
            note: it.note,
          })),
      }));
    },
  });

  /**
   * One run with its results, by id (#Q3977): what `usecase_run_attachment_add`
   * reads to confirm the run exists before it hands back a command line.
   */
  getUseCaseRun = $action({
    method: "GET",
    path: "/getUseCaseRun/:id",
    use: [this.ownsRun("usecase:read")],
    schema: {
      params: z.object({ id: z.integer() }),
      response: useCaseRunResourceSchema,
    },
    handler: async ({ params }) => {
      const run = this.owned.get<UseCaseRun>();
      const rows = await this.results.findMany({
        where: { runId: { eq: params.id } },
      });
      return {
        ...run,
        results: rows.map((it) => ({
          criterionKey: it.criterionKey,
          result: it.result,
          note: it.note,
        })),
      };
    },
  });

  /**
   * Upload a file of evidence; `addRunEvidence` then places it on a run.
   * The bucket takes 50 MB a file.
   */
  uploadRunEvidence = $action({
    method: "POST",
    path: "/useCaseRuns/evidence",
    // As a quest attachment's upload: the file is nobody's until
    // `addRunEvidence` places it, and that write is gated on the run.
    use: [$secure({ permissions: ["usecase:write"] })],
    schema: {
      body: z.object({
        file: z.file({
          maxBytes: RequirementsBuckets.EVIDENCE_MAX_SIZE_MB * 1024 * 1024,
        }),
      }),
      response: z.object({ fileId: z.uuid() }),
    },
    handler: async ({ body, user }) => {
      const file = await this.buckets.evidence.upload(body.file, { user });
      return { fileId: file.id };
    },
  });

  addRunEvidence = $action({
    method: "POST",
    path: "/addRunEvidence/:id",
    use: [this.ownsRunForWrite("usecase:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        fileId: z.uuid(),
        name: z.string().max(200),
        mimeType: z.string().max(120),
        size: z.number(),
        criterionKey: z.string().max(10).optional(),
        step: z.integer().optional(),
      }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params, body }) => {
      const run = this.owned.get<UseCaseRun>();
      if (run.evidence.some((it) => it.fileId === body.fileId)) {
        throw new BadRequestError("This file is already evidence of the run");
      }
      // A file placed on a criterion the run never recorded would show under
      // no criterion of the Runs tab (#Q3977).
      if (body.criterionKey) {
        const [result] = await this.results.findMany({
          where: {
            runId: { eq: params.id },
            criterionKey: { eq: body.criterionKey },
          },
          limit: 1,
        });
        if (!result) {
          throw new BadRequestError(
            `Run ${params.id} has no criterion ${body.criterionKey}`,
          );
        }
      }
      await this.runs.updateById(params.id, {
        evidence: [...run.evidence, body],
      });
      return { ok: true };
    },
  });
}
