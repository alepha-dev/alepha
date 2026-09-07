import { $inject, Alepha } from "alepha";
import { $job } from "alepha/api/jobs";
import { rankDefinitions, RankService } from "alepha/api/ranks";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { members } from "../entities/members.ts";
import { projects } from "../entities/projects.ts";
import { ProjectRankPresets } from "../security/ProjectRankPresets.ts";
import { ProjectRankResource } from "../security/ProjectRankResource.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export class ProjectRankJobs {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(members);
  protected readonly definitions = $repository(rankDefinitions);
  protected readonly ranks = $inject(RankService);
  protected readonly presets = $inject(ProjectRankPresets);
  protected readonly security = $inject(ProjectSecurityService);

  /**
   * Give a project that has never had its ranks configured the three presets
   * a project created today starts with.
   *
   * `createProject` is the only place that writes Admin, Contributor and
   * Viewer, so every project that existed before epic #E39 holds nothing but
   * the two built-ins - and its owner opens the members page to a rank picker
   * offering `Member` and nothing else (feedback #P2122). The presets were
   * always reachable through Ranks ▸ Create ▸ from a preset; what was missing
   * is them simply being there, the way they are in a new project.
   *
   * ⚠️ **A sweep rather than a one-shot task, because the seed is non-fatal
   * by contract.** `createProject` catches its own seeding failure and logs
   * it, on the reasoning that a project that works on its built-ins beats a
   * project creation that 500s. That means a project created AFTER #E39 can
   * be in this state too, and a one-shot backfill would leave it there
   * forever. This heals both.
   *
   * ## The predicate is "no definition rows at all"
   *
   * Not "no row for this preset key". A project with rows has been through
   * the rank editor, and an owner who deleted Admin on purpose must not find
   * it back tomorrow morning - a sweep that fights the person it is meant to
   * serve is worse than the gap it closes. Zero rows means nobody has ever
   * decided anything here, which is exactly the pre-#E39 state and the
   * failed-seed state.
   *
   * ⚠️ The one case that gets it wrong: an owner who deletes all three. They
   * come back on the next sweep. Carried knowingly - it is one keystroke away
   * from a project that never had them, and nothing on disk separates the
   * two.
   *
   * ## Idempotent, and safe after a partial pass
   *
   * D1 has no transaction to hide behind, so this seeds one project at a time
   * and one rank at a time, and a failure is logged and skipped rather than
   * thrown: the next night resumes at whatever is still missing. A project
   * that has been seeded has rows, so the predicate excludes it on every
   * later run without needing to remember anything.
   *
   * ## Language: English, decided rather than defaulted
   *
   * `nameFor` takes the CREATOR's language, read off the request. A sweep has
   * no request and no `Accept-Language`, so the language has to be chosen.
   * English, for three reasons: it is what `nameFor` already answers for
   * every language but French; `projects.preferredLanguage` exists but its
   * own contract says it does not affect the UI (it names the language AI
   * generates content in); and the name belongs to the owner from the moment
   * it lands, so a French project renames "Admin" once and keeps it.
   */
  public readonly seedMissingPresetRanks = $job({
    // Daily, an hour off `QuestJobs.sendDueReminders` so the two nightly
    // sweeps do not start together. It fires once with work to do and is two
    // queries every night after that.
    cron: "0 3 * * *",
    handler: async () => {
      // `distinct` takes the COLUMN LIST, not a boolean, and it is also the
      // projection - so this is one `SELECT DISTINCT scope_id` and never a
      // scan of every definition row in the instance.
      const configured = await this.definitions.findMany({
        where: { type: { eq: "project" } },
        distinct: ["scopeId"],
      });
      const hasRanks = new Set(configured.map((row) => row.scopeId));

      const all = await this.projects.findMany({ columns: ["id"] });
      const pending = all.filter((row) => !hasRanks.has(String(row.id)));

      if (!pending.length) return;

      this.log.info("seeding preset ranks for projects that hold none", {
        projects: pending.length,
      });

      for (const project of pending) {
        await this.seedProject(project.id);
      }
    },
  });

  /**
   * One project's three presets, written as its OWNER.
   *
   * ⚠️ Through `RankService.save` rather than into the table, so the module's
   * invariants run: never `admin:*`, only permissions this application
   * declares, never an owner-only act, always the floor. The presets are
   * computed to satisfy all four already - this is the check that they still
   * do, on a path nobody is watching.
   *
   * The writer has to be somebody, because `save` asks whether the writer
   * holds `rank:manage` and refuses to grant beyond what they hold. The owner
   * is the only honest answer: they are who would have created these by hand,
   * and they hold `*`. A project with no owner row is skipped rather than
   * seeded under an invented identity.
   */
  protected async seedProject(projectId: number): Promise<void> {
    try {
      const owner = await this.members.findOne({
        where: {
          projectId: { eq: projectId },
          rank: { eq: ProjectRankResource.OWNER_KEY },
        },
      });

      if (!owner) {
        this.log.warn("skipping preset ranks: the project has no owner row", {
          projectId,
        });
        return;
      }

      const capabilities = await this.security.capabilitiesOf(projectId);
      const enabled = Object.keys(capabilities) as Parameters<
        ProjectRankPresets["presetsFor"]
      >[0];

      // ⚠️ Its own context per project. `RankService.heldBy` reads
      // `currentRankAtom` off the store and `ResourceGateMemoProvider` memoizes
      // the membership read, and neither is seeded outside a request; a
      // context gives both somewhere to live, and a fresh one per project
      // stops one project's memoized membership answering for the next.
      await this.alepha.context.run(async () => {
        for (const preset of this.presets.presetsFor(enabled)) {
          await this.ranks.save(
            "project",
            String(projectId),
            {
              key: preset.key,
              // No language argument: see the note on the job above. This is
              // the decision, not a default reached by accident.
              name: this.presets.nameFor(preset),
              permissions: preset.permissions,
            },
            { id: owner.userId } as never,
          );
        }
      });
    } catch (error) {
      // Logged and skipped, never thrown: one project that cannot be seeded
      // must not stop the twenty-four after it, and the next sweep retries it
      // for free.
      this.log.warn("preset ranks were not seeded for this project", {
        projectId,
        error,
      });
    }
  }
}
