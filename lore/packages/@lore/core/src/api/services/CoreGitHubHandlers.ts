import { $hook, $inject } from "alepha";

import { GitHubText } from "./GitHubText.ts";
import { GitHubWebhookHandlers } from "./GitHubWebhookHandlers.ts";
import { ProjectRepositoryService } from "./ProjectRepositoryService.ts";

/**
 * Core's own GitHub events (#Q4364): what an installation and a repository
 * do to a project's connection, through the effects #Q4362 wrote.
 *
 * - `installation` deleted or suspended: every project connected through it
 *   is left disconnected, saying why.
 * - `installation_repositories` removed: the projects of those repositories.
 * - `repository` renamed or transferred: owner and name follow; deleted:
 *   the project is left disconnected.
 */
export class CoreGitHubHandlers {
  protected readonly handlers = $inject(GitHubWebhookHandlers);
  protected readonly repositories = $inject(ProjectRepositoryService);
  protected readonly text = $inject(GitHubText);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.handlers.register(
        "installation",
        async (context) => {
          if (context.installationId === undefined) return;
          if (context.action === "deleted") {
            await this.repositories.installationGone(
              context.installationId,
              "uninstalled",
            );
          } else if (context.action === "suspend") {
            await this.repositories.installationGone(
              context.installationId,
              "suspended",
            );
          }
        },
        { projectScoped: false },
      );
      this.handlers.register(
        "installation_repositories",
        async (context) => {
          if (
            context.installationId === undefined ||
            context.action !== "removed"
          ) {
            return;
          }
          const removed = Array.isArray(context.payload.repositories_removed)
            ? context.payload.repositories_removed
            : [];
          const ids = removed
            .map((it) => this.text.integer(this.text.object(it)?.id))
            .filter((id): id is number => id !== undefined);
          await this.repositories.repositoriesRemoved(
            context.installationId,
            ids,
          );
        },
        { projectScoped: false },
      );
      this.handlers.register(
        "repository",
        async (context) => {
          const repository = this.text.object(context.payload.repository);
          const id = this.text.integer(repository?.id);
          if (id === undefined) return;
          if (context.action === "deleted") {
            if (context.installationId !== undefined) {
              await this.repositories.repositoriesRemoved(
                context.installationId,
                [id],
              );
            }
            return;
          }
          if (
            context.action !== "renamed" &&
            context.action !== "transferred"
          ) {
            return;
          }
          const owner = this.text.text(
            this.text.object(repository?.owner)?.login,
            100,
          );
          const name = this.text.text(repository?.name, 100);
          if (!owner || !name) return;
          const defaultBranch = this.text.text(repository?.default_branch, 255);
          await this.repositories.repositoryRenamed(id, {
            owner,
            name,
            ...(defaultBranch ? { defaultBranch } : {}),
          });
        },
        { projectScoped: false },
      );
    },
  });
}
