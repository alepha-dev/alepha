import { AlephaError } from "../../core/errors/AlephaError.ts";
import type { Activity } from "../descriptors/$activity.ts";
import type { Workflow } from "../descriptors/$workflow.ts";

/**
 * Registry for managing workflow and activity definitions.
 *
 * This service stores and retrieves workflow and activity metadata,
 * allowing the engine to look up handlers and schemas by name.
 */
export class WorkflowRegistryService {
  private readonly workflows = new Map<string, Workflow>();
  private readonly activities = new Map<string, Activity>();

  /**
   * Register a workflow definition.
   */
  public registerWorkflow(workflow: Workflow): void {
    const key = `${workflow.name}:${workflow.version}`;
    if (this.workflows.has(key)) {
      throw new AlephaError(
        `Workflow ${workflow.name} version ${workflow.version} is already registered`,
      );
    }
    this.workflows.set(key, workflow);
  }

  /**
   * Register an activity definition.
   */
  public registerActivity(activity: Activity): void {
    if (this.activities.has(activity.name)) {
      throw new AlephaError(`Activity ${activity.name} is already registered`);
    }
    this.activities.set(activity.name, activity);
  }

  /**
   * Get a workflow definition by name and version.
   */
  public getWorkflow(name: string, version = "1"): Workflow | undefined {
    const key = `${name}:${version}`;
    return this.workflows.get(key);
  }

  /**
   * Get an activity definition by name.
   */
  public getActivity(name: string): Activity | undefined {
    return this.activities.get(name);
  }

  /**
   * List all registered workflows.
   */
  public listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * List all registered activities.
   */
  public listActivities(): Activity[] {
    return Array.from(this.activities.values());
  }
}
