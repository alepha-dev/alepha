import { AlephaError } from "alepha";

import type { AssignedWorkItem } from "../../api/schemas/assignedWorkItemSchema.ts";
import type { CapabilityKey } from "../../api/schemas/capabilityKeySchema.ts";

/**
 * The sections of `project_context` and `project_info` that a feature module
 * owns (#E75, #Q2623): Work's areas, active quests, epics and open releases,
 * Knowledge's folio index and pinned folios.
 *
 * Core declares the tools and their result contracts and reads no module's
 * table: each module registers the sections it fills. A `project_context`
 * section runs only while the project has its capability, and is ABSENT
 * otherwise (see the tool); a `project_info` section always runs. Sections
 * merge in `order`, which is also the order of their keys in the result, so
 * the output with every module present is exactly what it was before the
 * split.
 */
export class ProjectContextRegistry {
  protected readonly sections: ProjectContextSection[] = [];

  public register(section: ProjectContextSection): void {
    if (this.sections.some((it) => it.key === section.key)) {
      throw new AlephaError(
        `project_context section '${section.key}' is registered twice`,
      );
    }
    this.sections.push(section);
  }

  /**
   * What the registered sections add to `project_context`, for a project
   * with these capabilities. Loaded concurrently, merged in `order`.
   */
  public async context(
    input: ProjectContextInput,
    capabilities: ReadonlySet<CapabilityKey>,
  ): Promise<Record<string, unknown>> {
    const running = this.ordered().filter(
      (it) => it.context && capabilities.has(it.capability),
    );
    const parts = await Promise.all(running.map((it) => it.context!(input)));
    return Object.assign({}, ...parts);
  }

  /**
   * What the registered sections add to `project_info`, merged in `order`.
   */
  public async info(
    input: ProjectContextInput,
  ): Promise<Record<string, unknown>> {
    const running = this.ordered().filter((it) => it.info);
    const parts = await Promise.all(running.map((it) => it.info!(input)));
    return Object.assign({}, ...parts);
  }

  protected ordered(): ProjectContextSection[] {
    return [...this.sections].sort((a, b) => a.order - b.order);
  }
}

/**
 * One module's part of the orientation tools.
 */
export interface ProjectContextSection {
  key: string;
  order: number;
  /**
   * The capability that owns the `project_context` part: without it, the
   * keys are absent.
   */
  capability: CapabilityKey;
  context?: (input: ProjectContextInput) => Promise<Record<string, unknown>>;
  info?: (input: ProjectContextInput) => Promise<Record<string, unknown>>;
}

export interface ProjectContextInput {
  projectId: number;
  /**
   * The viewer's open work, already read by core for the project response.
   */
  assignedWork: AssignedWorkItem[];
}
