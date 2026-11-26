import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { type HostJob, hostJobs } from "../entities/hostJobs.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { projects } from "../entities/projects.ts";
import {
  type HostJobLogResource,
  hostJobLogSchema,
} from "../schemas/hostJobLogSchema.ts";
import type { HostJobPoke } from "../schemas/hostJobPokeSchema.ts";
import {
  type HostJobResource,
  hostJobResourceSchema,
} from "../schemas/hostJobResourceSchema.ts";
import {
  HOST_JOB_TERMINAL,
  HOST_JOB_WAKE_UP,
} from "../schemas/hostJobValues.ts";
import {
  type HostMachineJob,
  hostMachineJobSchema,
} from "../schemas/hostMachineJobSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { HostJobService } from "../services/HostJobService.ts";
import { HostService } from "../services/HostService.ts";

export type { HostJobLogResource, HostJobResource, HostMachineJob };

/**
 * A project's host jobs (#Q3984): the list, one job with its live log,
 * Cancel and Poke (#Q4456).
 *
 * Gated by the job's project, at `host:read`: the members who can see the
 * project's hosts see what ran on them. Cancel is a write under the same
 * rank: stopping a job takes nothing from anybody, and the member who
 * started one must be able to stop it.
 */
export class HostJobController {
  protected readonly service = $inject(HostJobService);
  protected readonly rows = $repository(hostJobs);
  protected readonly hostRows = $repository(hosts);
  protected readonly users = $repository(users);
  protected readonly projectRows = $repository(projects);
  protected readonly hostService = $inject(HostService);
  protected readonly owned = $inject(OwnedResourceProvider);

  protected ownsJob = (requires: string) =>
    $ownsProject({
      repository: () => this.rows,
      param: "jobId",
      requires,
    });

  /**
   * The host a `/hosts/:hostId/...` route names, gated in its home project.
   */
  protected ownsHost = (requires: string) =>
    $ownsProject({
      repository: () => this.hostRows,
      param: "hostId",
      requires,
    });

  listProjectJobs = $action({
    use: [$ownsProject({ param: "projectId", requires: "host:read" })],
    method: "GET",
    path: "/projects/:projectId/jobs",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ limit: z.integer().min(1).max(500).optional() }),
      response: z.object({ items: z.array(hostJobResourceSchema) }),
    },
    handler: async ({ params, query }) => {
      const rows = await this.service.listFor(
        params.projectId,
        query.limit ?? 100,
      );
      return { items: await this.present(rows) };
    },
  });

  getJob = $action({
    use: [this.ownsJob("host:read")],
    method: "GET",
    path: "/jobs/:jobId",
    schema: {
      params: z.object({ jobId: z.uuid() }),
      response: hostJobResourceSchema,
    },
    handler: async () => {
      const row = this.owned.get<HostJob>();
      const [job] = await this.present([row]);
      const model = await this.service.modelOf(row);
      const pokes = await this.pokesOf(row);
      const [host] = await this.hostRows.findMany({
        where: { id: { eq: row.hostId } },
        columns: ["id", "jobsTools"],
        limit: 1,
      });
      return {
        ...job,
        ...(model ? { model } : {}),
        ...(this.service.pokeable(row, host ?? undefined)
          ? { pokeable: true }
          : {}),
        ...(pokes.length ? { pokes } : {}),
      };
    },
  });

  /**
   * The log past what the caller holds, `stdout` and `stderr` in bytes. With
   * `tail`, the last `tail` bytes of stdout instead, and no stderr: what the
   * header's jobs list reads a running job's last line from (#Q4514),
   * never the whole log.
   */
  getJobLog = $action({
    use: [this.ownsJob("host:read")],
    method: "GET",
    path: "/jobs/:jobId/log",
    schema: {
      params: z.object({ jobId: z.uuid() }),
      query: z.object({
        stdout: z.integer().min(0).optional(),
        stderr: z.integer().min(0).optional(),
        tail: z.integer().min(1).max(65_536).optional(),
      }),
      response: hostJobLogSchema,
    },
    handler: async ({ params, query }) => {
      const job = await this.service.getRow(params.jobId);
      const log =
        query.tail !== undefined
          ? await this.service.readTail(params.jobId, query.tail)
          : await this.service.readLog(params.jobId, query);
      return { ...log, live: !HOST_JOB_TERMINAL.includes(job.status) };
    },
  });

  cancelJob = $action({
    use: [this.ownsJob("host:read")],
    method: "POST",
    path: "/jobs/:jobId/cancel",
    schema: {
      params: z.object({ jobId: z.uuid() }),
      response: hostJobResourceSchema,
    },
    handler: async ({ params, user }) => {
      const job = await this.service.cancel(params.jobId, user?.id);
      const [resource] = await this.present([job]);
      return resource;
    },
  });

  /**
   * Sends a member's message to a running agent job (#Q4456): Poke, under
   * Cancel's rank, since it too only steers a job somebody already started.
   * A job's own key never reaches this route (a job key is MCP only), and
   * `job_poke` refuses one: a job never drives a job.
   */
  pokeJob = $action({
    use: [this.ownsJob("host:read")],
    method: "POST",
    path: "/jobs/:jobId/poke",
    schema: {
      params: z.object({ jobId: z.uuid() }),
      // Absent or blank, the Wake up preset.
      body: z.object({ message: z.string().max(8000).optional() }),
      response: hostJobResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const job = await this.service.poke(
        params.jobId,
        body.message?.trim() || HOST_JOB_WAKE_UP,
        user?.id,
      );
      const [resource] = await this.present([job]);
      return { ...resource, pokes: await this.pokesOf(job) };
    },
  });

  /**
   * Every job of a machine, newest first, whatever its project (#Q4524):
   * the Jobs tab of the host's console.
   *
   * Gated by the host's **home** project, at `host:read`, where every other
   * read of a job is gated by the job's own. So a job of a project the
   * reader holds no `host:read` in is answered by what the machine knows
   * alone: see `hostMachineJobSchema`.
   */
  listHostJobs = $action({
    use: [this.ownsHost("host:read")],
    method: "GET",
    path: "/hosts/:hostId/jobs",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      query: z.object({ limit: z.integer().min(1).max(500).optional() }),
      response: z.object({ items: z.array(hostMachineJobSchema) }),
    },
    handler: async ({ query, user }) => {
      const host = this.owned.get<Host>();
      const rows = await this.service.listOn(host.id, query.limit ?? 100);
      return { items: await this.presentOnMachine(rows, user) };
    },
  });

  /**
   * Stops a job of the machine, another project's included (#Q4524), under
   * `host:update` in the host's home project: the machine is its operator's,
   * and stopping a job reads nothing of it. A job that ran elsewhere is a
   * 404, so the route never reaches past its host.
   */
  cancelHostJob = $action({
    use: [this.ownsHost("host:update")],
    method: "POST",
    path: "/hosts/:hostId/jobs/:jobId/cancel",
    schema: {
      params: z.object({ hostId: z.uuid(), jobId: z.uuid() }),
      response: hostMachineJobSchema,
    },
    handler: async ({ params, user }) => {
      const host = this.owned.get<Host>();
      const job = await this.service.getRow(params.jobId);
      if (job.hostId !== host.id) {
        throw new NotFoundError("No such job");
      }
      const cancelled = await this.service.cancel(job.id, user.id);
      const [row] = await this.presentOnMachine([cancelled], user);
      return row;
    },
  });

  /**
   * Rows as a machine's console shows them to `user`: the project behind
   * each in one query, the reader's permissions computed once per project,
   * and the project's own half only where they hold `host:read`.
   */
  protected async presentOnMachine(
    rows: HostJob[],
    user: UserAccountToken,
  ): Promise<HostMachineJob[]> {
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    const projectList = projectIds.length
      ? await this.projectRows.findMany({
          where: { id: { inArray: projectIds } },
          columns: ["id", "title", "slug"],
        })
      : [];
    const readable = new Set<number>();
    for (const projectId of projectIds) {
      const can = await this.hostService.hostPermissionsIn(projectId, user);
      if (can.includes("host:read")) {
        readable.add(projectId);
      }
    }
    const starterIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.startedBy && readable.has(row.projectId) ? [row.startedBy] : [],
        ),
      ),
    ];
    const people = starterIds.length
      ? await this.users.findMany({
          where: { id: { inArray: starterIds } },
          columns: ["id", "username"],
        })
      : [];
    return rows.map((row) => {
      const project = projectList.find((it) => it.id === row.projectId);
      const open = readable.has(row.projectId);
      const starter = people.find((it) => it.id === row.startedBy)?.username;
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        queuedAt: row.queuedAt,
        ...(row.startedAt ? { startedAt: row.startedAt } : {}),
        ...(row.endedAt ? { endedAt: row.endedAt } : {}),
        ...(row.turns != null ? { turns: row.turns } : {}),
        ...(row.inputTokens != null ? { inputTokens: row.inputTokens } : {}),
        ...(row.outputTokens != null ? { outputTokens: row.outputTokens } : {}),
        project: {
          id: row.projectId,
          title: project?.title ?? "",
          ...(project?.slug ? { slug: project.slug } : {}),
        },
        readable: open,
        // The project's own half: named field by field, never spread.
        ...(open
          ? {
              ...(row.prompt ? { prompt: row.prompt } : {}),
              ...(row.args ? { args: row.args } : {}),
              ...(row.cause ? { cause: row.cause } : {}),
              ...(row.subjectType ? { subjectType: row.subjectType } : {}),
              ...(row.subjectId ? { subjectId: row.subjectId } : {}),
              ...(starter ? { startedByName: starter } : {}),
              ...(row.reason ? { reason: row.reason } : {}),
            }
          : {}),
      };
    });
  }

  /**
   * A job's pokes with their senders' names.
   */
  protected async pokesOf(row: HostJob): Promise<HostJobPoke[]> {
    const pokes = await this.service.pokesOf(row);
    const ids = [...new Set(pokes.flatMap((it) => (it.by ? [it.by] : [])))];
    const people = ids.length
      ? await this.users.findMany({
          where: { id: { inArray: ids } },
          columns: ["id", "username"],
        })
      : [];
    return pokes.map((poke) => {
      const name = people.find((it) => it.id === poke.by)?.username;
      return name ? { ...poke, byName: name } : poke;
    });
  }

  /**
   * Rows as resources, the host slugs and starter names in one query each.
   */
  public async present(rows: HostJob[]): Promise<HostJobResource[]> {
    const hostIds = [...new Set(rows.map((row) => row.hostId))];
    const starterIds = [
      ...new Set(rows.flatMap((row) => (row.startedBy ? [row.startedBy] : []))),
    ];
    const hostList = hostIds.length
      ? await this.hostRows.findMany({
          where: { id: { inArray: hostIds } },
          columns: ["id", "slug", "jobsResult"],
        })
      : [];
    const people = starterIds.length
      ? await this.users.findMany({
          where: { id: { inArray: starterIds } },
          columns: ["id", "username"],
        })
      : [];
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      hostId: row.hostId,
      hostSlug: hostList.find((host) => host.id === row.hostId)?.slug,
      kind: row.kind,
      status: row.status,
      input: row.input,
      startedBy: row.startedBy ?? undefined,
      startedByName:
        people.find((person) => person.id === row.startedBy)?.username ??
        undefined,
      startedByJobId: row.startedByJobId ?? undefined,
      subjectType: row.subjectType ?? undefined,
      subjectId: row.subjectId ?? undefined,
      commandId: row.commandId ?? undefined,
      queuedAt: row.queuedAt,
      startedAt: row.startedAt ?? undefined,
      endedAt: row.endedAt ?? undefined,
      reason: row.reason ?? undefined,
      exitCode: row.exitCode ?? undefined,
      commit: row.commit ?? undefined,
      warning: row.warning ?? undefined,
      logBytes: row.logBytes ?? undefined,
      logTruncated: row.logTruncated ?? undefined,
      prompt: row.prompt ?? undefined,
      args: row.args ?? undefined,
      cause: row.cause ?? undefined,
      result: row.result ?? undefined,
      resultTruncated: row.resultTruncated ?? undefined,
      turns: row.turns ?? undefined,
      inputTokens: row.inputTokens ?? undefined,
      outputTokens: row.outputTokens ?? undefined,
      costUsd: row.costUsd ?? undefined,
      hostReturnsResult:
        hostList.find((host) => host.id === row.hostId)?.jobsResult ??
        undefined,
    }));
  }
}
