import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";
import { ProjectErrorThread } from "./ProjectErrorThread.ts";

/**
 * The errors a use case run opens and resolves (#E153), written by Plan's
 * Requirements through this service: one error per failing criterion,
 * keyed `usecase:<useCaseId>:<criterionKey>`, bumped by every later failing
 * run and resolved by a passing one. Ship never reads the run tables.
 */
export class RunErrorService {
  protected readonly projectErrors = $repository(projectErrors);
  protected readonly thread = $inject(ProjectErrorThread);

  public fingerprint(useCaseId: number, criterionKey: string): string {
    return `usecase:${useCaseId}:${criterionKey}`;
  }

  /**
   * Open the criterion's error, or bump it and reopen it when it exists.
   */
  public async failed(input: {
    projectId: number;
    useCaseId: number;
    useCaseRunId: number;
    criterionKey: string;
    name: string;
    message: string;
    stack: string;
    at: string;
  }): Promise<void> {
    const fingerprint = this.fingerprint(input.useCaseId, input.criterionKey);
    const message = input.message.slice(0, 2000);
    const stack = input.stack.slice(0, 4096);
    const [existing] = await this.projectErrors.findMany({
      where: {
        projectId: { eq: input.projectId },
        fingerprint: { eq: fingerprint },
      },
      limit: 1,
    });
    if (existing) {
      await this.projectErrors.updateById(existing.id, {
        message,
        stack,
        lastSeenAt: input.at,
        count: existing.count + 1,
        useCaseRunId: input.useCaseRunId,
        // A forwarded error keeps its quest; a resolved one reopens.
        ...(existing.status === "resolved" ? { status: "open" } : {}),
      });
      // Lore reopened it, nobody did (#E185): no actor.
      if (existing.status === "resolved") {
        await this.thread.record(existing.id, "run_reopened");
      }
      return;
    }
    await this.projectErrors.create({
      projectId: input.projectId,
      fingerprint,
      name: input.name.slice(0, 200),
      message,
      stack,
      origin: "run",
      firstSeenAt: input.at,
      lastSeenAt: input.at,
      count: 1,
      status: "open",
      useCaseRunId: input.useCaseRunId,
      criterionKey: input.criterionKey,
    });
  }

  /**
   * A passing run resolves the criterion's open error, if any.
   */
  public async passed(input: {
    projectId: number;
    useCaseId: number;
    criterionKey: string;
    at: string;
  }): Promise<boolean> {
    const fingerprint = this.fingerprint(input.useCaseId, input.criterionKey);
    const [existing] = await this.projectErrors.findMany({
      where: {
        projectId: { eq: input.projectId },
        fingerprint: { eq: fingerprint },
        status: { eq: "open" },
      },
      limit: 1,
    });
    if (!existing) return false;
    await this.projectErrors.updateById(existing.id, {
      status: "resolved",
      lastSeenAt: input.at,
    });
    await this.thread.record(existing.id, "run_resolved");
    return true;
  }
}
