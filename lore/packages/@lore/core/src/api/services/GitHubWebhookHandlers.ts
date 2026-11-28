import type { ProjectRepository } from "../entities/projectRepositories.ts";

/**
 * What a handler is given for one stored delivery.
 */
export interface GitHubWebhookContext {
  /**
   * `X-GitHub-Delivery`.
   */
  delivery: string;
  event: string;
  action?: string;
  installationId?: number;
  /**
   * The payload as GitHub sent it, parsed. Untrusted: a handler reads the
   * fields it uses through `GitHubText`, capped, and nothing else.
   */
  payload: Record<string, unknown>;
  /**
   * The connected repository the delivery is about, when it is about one a
   * project holds. A repository-scoped event with none is dropped before any
   * handler runs.
   */
  connection?: ProjectRepository;
}

/**
 * A handler of one GitHub event. It must be idempotent: the sweep may run a
 * delivery twice.
 */
export type GitHubWebhookHandler = (
  context: GitHubWebhookContext,
) => Promise<void>;

/**
 * The GitHub events Lore handles, and who handles each (#Q4364).
 *
 * A package registers a handler per event, the way it registers its project
 * events: core its `installation`, `installation_repositories` and
 * `repository`; Plan its `pull_request`, `push`, checks and statuses
 * (#Q4367). `projectScoped: false` is for an event about the installation
 * rather than one repository.
 */
export class GitHubWebhookHandlers {
  protected readonly handlers = new Map<
    string,
    Array<{ handle: GitHubWebhookHandler; projectScoped: boolean }>
  >();

  register(
    event: string,
    handle: GitHubWebhookHandler,
    options: { projectScoped?: boolean } = {},
  ): void {
    const list = this.handlers.get(event) ?? [];
    list.push({ handle, projectScoped: options.projectScoped ?? true });
    this.handlers.set(event, list);
  }

  handlersOf(
    event: string,
  ): Array<{ handle: GitHubWebhookHandler; projectScoped: boolean }> {
    return this.handlers.get(event) ?? [];
  }

  /**
   * Whether any handler of the event needs the delivery's repository to
   * belong to a project.
   */
  projectScoped(event: string): boolean {
    return this.handlersOf(event).some((it) => it.projectScoped);
  }
}
