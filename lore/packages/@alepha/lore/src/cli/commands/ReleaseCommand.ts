import type { ReleaseController } from "@lore/work/api";
import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $client } from "alepha/server/links";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore releases` - the release job's side of a Lore release.
 *
 * ```bash
 * export LORE_API_KEY=...
 * lore releases check --tag 0.28.0
 * lore releases cut --bump minor --notes notes.md --env-file "$GITHUB_ENV"
 * lore releases changelog --tag 0.28.0
 * lore releases publish --tag 0.28.0
 * ```
 *
 * `check` refuses a release whose quests are not all completed, and runs
 * before anything irreversible; `cut` prepares a version locally
 * (package.json, CHANGELOG.md, commit, tag)
 * from the open Lore release that carries it; `changelog` prints that
 * release's notes; `publish` flips it to published once the version shipped.
 * Nothing here pushes: the builds, the git push and the GitHub Release stay in
 * the project's workflow, because they are what differs between projects.
 *
 * ## ⚠️ `publish`: not found and already published both exit 0, on purpose
 *
 * `quality push` and `artifacts push` fail loudly, and their JSDoc says so:
 * a build that cannot be reported is a build fact worth a red step. Whether a
 * Lore release carries the version tag is a PLANNING fact. A release job that
 * goes red because nobody created a Lore release for this version blocks
 * nothing useful and reads as a failed release, so the missing release is a
 * log line and a clean exit. The already-published case is what makes a
 * re-run of the job safe.
 *
 * Everything else still fails loudly: a wrong key, a project the key cannot
 * see, a release the key may not publish. Those are configuration facts, and
 * silence there would hide a job that has stopped doing its work.
 *
 * ## ⚠️ An incomplete release never ships (#Q2600)
 *
 * Alepha 0.31.0 was published at 47/66, because nothing here read
 * `progress`. `check`, `cut`, `changelog` and `publish` all refuse an open
 * release with `progress.completed < progress.total`, listing what is left.
 * Shelved quests sit outside `total`, so declined work never blocks. There
 * is no flag to ship anyway: move or shelve the open work in Lore, so the
 * release records what actually shipped.
 *
 * `check` exists because the others run too late in a typical job:
 * `publish` is the LAST step, after npm and the tag push, where a refusal
 * only turns a public release red. A job runs `check` right after it
 * computes the version. It keeps `publish`'s quiet exits for a missing or
 * an already-published release.
 *
 * ## Why the release is found client-side
 *
 * There is no get-by-tag endpoint on `ReleaseController`. `ReleaseTools` in
 * Lore's MCP already lists the project's releases and finds the tag in
 * memory, and this does the same rather than adding a second lookup shape to
 * the server for one caller. Case-sensitive, because `releaseTagSchema`
 * preserves case so a tag can match `artifacts.tag` byte for byte.
 *
 * ## ⚠️ The controller type is a TYPE, and must stay one
 *
 * `import type`, so it is erased: nothing from Lore's server graph is loaded.
 * It must never reach an exported signature of `@alepha/lore/cli`; this class
 * is deliberately not re-exported from `index.ts`, and `scripts/check-dts.ts`
 * fails the build if an emitted `.d.ts` names the private `lore` workspace.
 */
export class ReleaseCommand {
  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * ⚠️ Declared after `client`, and it has to be: a field initializer reading
   * another field sees `undefined` if that field is declared below it.
   *
   * The scope resolves the hostname now and the credential per request, which
   * is what lets this class be constructed on a machine holding no key at all:
   * `--help` has to work there.
   */
  protected readonly api = $client<ReleaseController>(this.client.scope());

  public readonly publish = $command({
    name: "publish",
    description:
      "Publish the Lore release carrying a version tag, when there is one",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      tag: z.text({
        aliases: ["t"],
        description:
          "The release's tag, byte for byte: `0.28.0`, the version the job just shipped.",
      }),
    }),
    handler: async ({ flags }) => {
      const project = this.client.resolveProject(flags.project);
      const projectId = await this.projects.resolve(project);

      const releases = await this.api.getReleases({ params: { projectId } });
      const release = releases.find((it) => it.tag === flags.tag);

      if (!release) {
        this.log.info(
          `No release tagged ${flags.tag} in ${project}: nothing to publish`,
        );
        return;
      }

      if (release.releasedAt) {
        this.log.info(
          `Release ${flags.tag} in ${project} is already published, since ${release.releasedAt}`,
        );
        return;
      }

      await this.assertComplete(release, flags.tag, project);

      const published = await this.api.publishRelease({
        params: { id: release.id },
        body: {},
      });
      this.log.info(`Published release ${published.tag} in ${project}`, {
        releasedAt: published.releasedAt,
      });
    },
  });

  /**
   * The notes of the OPEN release carrying `tag`, ready to sit under a
   * `## [x.y.z]` section: Lore's own `# Release` title dropped, every other
   * heading one level down.
   *
   * ⚠️ Loud where `publish` is quiet. A release job that cannot get its notes
   * must stop before it tags anything: a missing release means the version
   * was never planned, and a published one means it already shipped.
   */
  protected async notes(tag: string, named?: string): Promise<string> {
    const project = this.client.resolveProject(named);
    const projectId = await this.projects.resolve(project);

    const releases = await this.api.getReleases({ params: { projectId } });
    const release = releases.find((it) => it.tag === tag);
    if (!release) {
      throw new AlephaError(
        `No release tagged ${tag} in ${project}: create it in Lore first`,
      );
    }
    if (release.releasedAt) {
      throw new AlephaError(
        `Release ${tag} in ${project} was already published, on ${release.releasedAt}`,
      );
    }
    await this.assertComplete(release, tag, project);

    const { markdown } = await this.api.getReleaseChangelog({
      params: { id: release.id },
    });
    return markdown
      .replace(/^# .*\n+/, "")
      .replace(/^(#+) /gm, "#$1 ")
      .trim();
  }

  /**
   * Refuses an open release that still holds unfinished work, naming it.
   *
   * `progress` comes with every row of `getReleases`; the contents are only
   * fetched to word the refusal, so a complete release costs no extra call.
   */
  protected async assertComplete(
    release: { id: number; progress: { completed: number; total: number } },
    tag: string,
    project: string,
  ): Promise<void> {
    const progress = release.progress;
    if (progress.completed >= progress.total) return;

    const contents = await this.api.getReleaseContents({
      params: { id: release.id },
    });
    type Quest = (typeof contents.looseQuests)[number];
    const open = (quest: Quest) => !quest.completedAt && !quest.shelvedAt;
    const line = (quest: Quest) =>
      `    #Q${quest.shortId} ${quest.title} (${quest.acceptedAt ? "in progress" : "todo"})`;

    const lines: string[] = [];
    for (const epic of contents.epics) {
      const left = epic.quests.filter(open);
      if (left.length === 0) continue;
      lines.push(
        `  #E${epic.number} ${epic.title}: ${epic.completed}/${epic.total}`,
      );
      lines.push(...left.map(line));
    }
    const loose = contents.looseQuests.filter(open);
    if (loose.length > 0) {
      lines.push("  Loose quests:");
      lines.push(...loose.map(line));
    }

    throw new AlephaError(
      `Release ${tag} in ${project} is ${progress.completed}/${progress.total} complete. ` +
        "Finish, move or shelve the rest in Lore before releasing:\n\n" +
        lines.join("\n"),
    );
  }

  /**
   * `lore releases check` - the gate a release job runs before anything
   * irreversible: fails while the open release carrying the tag holds
   * unfinished quests. A missing or already-published release exits 0, for
   * the reasons `publish` gives.
   */
  public readonly check = $command({
    name: "check",
    description:
      "Fail when the open Lore release carrying a version tag still has unfinished quests",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      tag: z.text({
        aliases: ["t"],
        description:
          "The release's tag, byte for byte: `0.28.0`, the version about to ship.",
      }),
    }),
    handler: async ({ flags }) => {
      const project = this.client.resolveProject(flags.project);
      const projectId = await this.projects.resolve(project);

      const releases = await this.api.getReleases({ params: { projectId } });
      const release = releases.find((it) => it.tag === flags.tag);

      if (!release) {
        this.log.info(
          `No release tagged ${flags.tag} in ${project}: nothing to check`,
        );
        return;
      }
      if (release.releasedAt) {
        this.log.info(
          `Release ${flags.tag} in ${project} is already published, since ${release.releasedAt}`,
        );
        return;
      }

      await this.assertComplete(release, flags.tag, project);
      this.log.info(
        `Release ${flags.tag} in ${project} is complete: ${release.progress.completed}/${release.progress.total}`,
      );
    },
  });

  public readonly changelog = $command({
    name: "changelog",
    description:
      "Print the changelog of the open Lore release carrying a version tag, as Markdown",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      tag: z.text({
        aliases: ["t"],
        description: "The release's tag, byte for byte: `0.28.0`.",
      }),
    }),
    handler: async ({ flags, print }) => {
      print(await this.notes(flags.tag, flags.project));
    },
  });

  /**
   * The next version: `x.y.z` bumped at one position, the lower ones reset.
   * Only a plain `x.y.z` is accepted, because the result has to match a
   * Lore release tag byte for byte.
   */
  public nextVersion(current: string, bump: "major" | "minor" | "patch") {
    if (!/^\d+\.\d+\.\d+$/.test(current)) {
      throw new AlephaError(
        `package.json's version "${current}" is not a plain x.y.z`,
      );
    }
    const [major, minor, patch] = current.split(".").map(Number);
    if (bump === "major") return `${major + 1}.0.0`;
    if (bump === "minor") return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }

  /**
   * `lore releases cut` - prepare a version locally, from its Lore release.
   *
   * Bumps the root `package.json`, prepends the release's notes to
   * CHANGELOG.md under `## [x.y.z] - YYYY-MM-DD`, commits `release: x.y.z`
   * and tags it. It never pushes: a job builds and stores its artifacts
   * after this, and only pushes once they all made it, so a red build leaves
   * nothing public behind.
   *
   * Every check comes before the first write: a version that is not a plain
   * `x.y.z`, a tag that already exists, or a release that is missing or
   * published stops it with the working tree untouched.
   */
  public readonly cut = $command({
    name: "cut",
    description:
      "Bump package.json, prepend the Lore release's notes to CHANGELOG.md, commit and tag, locally",
    flags: z.object({
      project: z
        .text({
          aliases: ["p"],
          description:
            "Lore project slug, overriding LORE_PROJECT for this invocation",
        })
        .optional(),
      bump: z
        .enum(["major", "minor", "patch"])
        .describe("Which part of package.json's version to bump"),
      notes: z
        .text({
          description:
            "Also write the notes to this file, e.g. for a GitHub Release body",
        })
        .optional(),
      envFile: z
        .text({
          aliases: ["env-file"],
          description:
            'Append `VERSION=x.y.z` to this file, e.g. "$GITHUB_ENV" so later steps read it',
        })
        .optional(),
    }),
    handler: async ({ flags, root }) => {
      const pkgPath = this.fs.join(root, "package.json");
      const pkg = JSON.parse(await this.fs.readTextFile(pkgPath)) as {
        version?: string;
      };
      if (!pkg.version) {
        throw new AlephaError(
          'package.json has no version: add "version": "0.0.0" first',
        );
      }
      const version = this.nextVersion(pkg.version, flags.bump);

      const tagged = await this.shell.capture(
        ["git", "rev-parse", "-q", "--verify", `refs/tags/${version}`],
        { root },
      );
      if (tagged.exitCode === 0) {
        throw new AlephaError(`Tag ${version} already exists`);
      }

      const notes = await this.notes(version, flags.project);

      pkg.version = version;
      await this.fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

      const changelogPath = this.fs.join(root, "CHANGELOG.md");
      const previous = (await this.fs.exists(changelogPath))
        ? await this.fs.readTextFile(changelogPath)
        : "";
      const date = this.dateTime.now().format("YYYY-MM-DD");
      await this.fs.writeFile(
        changelogPath,
        `## [${version}] - ${date}\n\n${notes}\n\n${previous}`,
      );

      await this.shell.run(["git", "add", "package.json", "CHANGELOG.md"], {
        root,
      });
      await this.shell.run(["git", "commit", "-m", `release: ${version}`], {
        root,
      });
      await this.shell.run(
        ["git", "tag", "-a", version, "-m", `release: ${version}`],
        { root },
      );

      if (flags.notes) {
        await this.fs.writeFile(flags.notes, `${notes}\n`);
      }
      if (flags.envFile) {
        await this.fs.appendFile(flags.envFile, `VERSION=${version}\n`);
      }

      this.log.info(
        `Cut ${version}: package.json, CHANGELOG.md, commit and tag`,
      );
    },
  });

  public readonly releases = $command({
    name: "releases",
    description: "The releases of a Lore project",
    children: [this.check, this.cut, this.changelog, this.publish],
    handler: async ({ help }) => {
      help();
    },
  });
}
