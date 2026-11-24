import type { LiveQuestController } from "@lore/ship/api";
import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { $client } from "alepha/server/links";

import { GitContextService } from "../services/GitContextService.ts";
import { GitQuestHistory } from "../services/GitQuestHistory.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectLink } from "../services/LoreProjectLink.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore commits push` (#Q4234): the quests a commit's history names, sent
 * with no artifact, for a project that does not deploy through Lore. Run
 * from CI on every push of the default branch, it is what completes a quest
 * an agent automation built once the commit naming it lands there:
 *
 * ```yaml
 * - run: npx @alepha/lore commits push --project acme
 * ```
 *
 * The walk is the artifact push's: from the newest ancestor Lore already
 * holds a complete set for, so a push walks only what is new. `import type`
 * only, for the reason `QualityCommand` gives.
 */
export class CommitsCommand {
  /**
   * The most walked shas one push sends, as the endpoint takes them. Past
   * it the set is partial: the next push, on a base Lore now holds, walks
   * the rest.
   */
  public static readonly MAX_WALKED = 20_000;

  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);
  protected readonly git = $inject(GitContextService);
  protected readonly history = $inject(GitQuestHistory);
  protected readonly link = $inject(LoreProjectLink);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly api = $client<LiveQuestController>(this.client.scope());

  public readonly push = $command({
    name: "push",
    description:
      "Record the quests the current commit's history names; on the default branch, complete the quests an agent automation built",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      branch: z
        .text({
          description:
            "The branch the commit is on, instead of the checked-out one (GITHUB_REF_NAME in CI)",
        })
        .optional(),
      defaultBranch: z
        .text({
          description:
            "The repository's default branch, when neither the CI event nor git's origin/HEAD names it (Lore takes main)",
        })
        .optional(),
    }),
    handler: async ({ flags, root }) => {
      const project = this.client.resolveProject(flags.project);
      const [projectId, git, defaultBranch, link] = await Promise.all([
        this.projects.resolve(project),
        this.git.resolve(root),
        flags.defaultBranch
          ? Promise.resolve(flags.defaultBranch)
          : this.git.defaultBranch(root),
        this.link.find(root).catch(() => undefined),
      ]);
      if (!git.commitSha) {
        this.log.warn("No commit to record: this is not a git repository");
        return;
      }
      const walk = await this.history.walk({
        root,
        bare: link?.bareQuestRefs === true,
        known: async (shas) => {
          try {
            return (
              await this.api.findKnownCommits({
                params: { projectId },
                body: { shas },
              })
            ).known;
          } catch {
            return undefined;
          }
        },
      });
      const capped = walk.walked.length > CommitsCommand.MAX_WALKED;
      const branch = flags.branch || git.branch;
      const answer = await this.api.pushCommitQuests({
        params: { projectId },
        body: {
          commitSha: git.commitSha,
          quests: {
            version: 1,
            ...(walk.base ? { base: walk.base } : {}),
            numbers: walk.numbers,
            complete: walk.complete && !capped,
          },
          walked: walk.walked.slice(0, CommitsCommand.MAX_WALKED),
          ...(branch && branch !== GitContextService.UNKNOWN_BRANCH
            ? { branch }
            : {}),
          ...(defaultBranch ? { defaultBranch } : {}),
        },
      });
      this.log.info(
        `${answer.count} quest${answer.count === 1 ? "" : "s"} recorded on ${git.commitSha.slice(0, 12)} (${answer.complete ? "complete" : "partial"})${answer.landed ? `, on the default branch: the quests an automation built that it names are completed` : ""}`,
      );
    },
  });

  public readonly commits = $command({
    name: "commits",
    description: "The quests a commit's history names",
    children: [this.push],
    handler: async ({ help }) => {
      help();
    },
  });
}
