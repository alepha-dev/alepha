import { LoreDatabase, ProjectEvents, SourceRepository } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { ConflictError } from "alepha/server";

import { type ProjectError, projectErrors } from "../entities/projectErrors.ts";
import { ProjectErrorThread } from "./ProjectErrorThread.ts";
import { ShipProjectEvents } from "./ShipProjectEvents.ts";

/**
 * `error.trusted` (#Q4331): an error group an agent may read from now on,
 * recorded once per group, when it becomes trusted, and never per
 * occurrence, so one noisy error does not re-plan a triage all day.
 *
 * Two ways in: a member trusts a group (#Q4233), recorded atomically with
 * the trust; and a new server group trusted on arrival (#Q4255), recorded
 * after the ingest that created it.
 *
 * ⚠️ Two ingests of one new server error running at the same moment can
 * both find it new and record it twice. Accepted: it costs a second triage
 * run, queued behind the first, on a race between two Workers.
 */
export class ErrorTrustEvents {
  /**
   * Injected so `error.trusted` is in the catalog whatever booted this.
   */
  protected readonly eventDefinitions = $inject(ShipProjectEvents);
  protected readonly log = $logger();
  protected readonly projects = $repository(projects);
  protected readonly errors = $inject(SourceRepository.of(projectErrors));
  protected readonly events = $inject(ProjectEvents);
  protected readonly database = $inject(LoreDatabase);
  protected readonly thread = $inject(ProjectErrorThread);

  /**
   * A member trusts a group, and `error.trusted` is recorded with it. The
   * guard is the group still untrusted.
   */
  public async trust(
    error: ProjectError,
    trustedBy: string,
    trustedAt: string,
  ): Promise<ProjectError> {
    const project = await this.projects.getById(error.projectId);
    try {
      const trusted = await this.errors.sourceUpdate(
        { id: error.id, trustedAt: { isNull: true } },
        { trustedAt, trustedBy },
        {
          projectId: error.projectId,
          name: "error.trusted",
          subjectId: error.id,
          resourceId: error.id,
          actorId: trustedBy,
          fields: this.fields(project, error, trustedBy),
        },
      );
      // The line of the error's own thread (#E185), after the trust: the
      // member who lost the race below trusted nothing, and leaves none.
      await this.thread.record(error.id, "trusted", { actorId: trustedBy });
      return trusted;
    } catch (failure) {
      // Two members trusting at once: the other one won, and the group is
      // trusted, which is what this one asked for. Anything else stays a
      // failure.
      if (!(failure instanceof ConflictError)) throw failure;
      const row = await this.errors.findOne({
        where: { id: { eq: error.id } },
      });
      if (!row?.trustedAt) throw failure;
      return row;
    }
  }

  /**
   * The new groups an ingest trusted on arrival, one event each.
   *
   * Never thrown: the ingest that created them has already landed, and a
   * report must not be refused because its event could not be recorded.
   */
  public async arrived(rows: ProjectError[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      const project = await this.projects.getById(rows[0]!.projectId);
      for (const error of rows) {
        const recorded = await this.events.emit({
          projectId: error.projectId,
          name: "error.trusted",
          subjectId: error.id,
          // No job: the ingest may run at the end of whichever request
          // flushed the batch, an agent's included, and that request did not
          // cause these errors. Crediting its job would keep the triage it
          // should start from starting.
          jobId: null,
          fields: this.fields(project, error),
        });
        await this.database.batch(recorded.statements);
        await recorded.committed();
      }
    } catch (error) {
      this.log.warn("A trusted error group's event could not be recorded", {
        error,
      });
    }
  }

  protected fields(
    project: { id: number; slug?: string | null; title: string },
    error: ProjectError,
    trustedBy?: string,
  ): Record<string, unknown> {
    return {
      project: project.title,
      title: error.name,
      error_id: error.id,
      error_name: error.name,
      origin: error.origin,
      ...(trustedBy ? { trusted_by: trustedBy } : {}),
      // The error's own page (#E185): the event is about this one error.
      url: `/${project.slug || `project-${project.id}`}/errors/${error.id}`,
    };
  }
}
