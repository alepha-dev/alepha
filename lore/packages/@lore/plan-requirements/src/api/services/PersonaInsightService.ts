import {
  BoundParameters,
  ProjectSecurityService,
  ResourceLinkService,
} from "@lore/core/api";
import { epics, quests, releases } from "@lore/plan/schemas";
import { appInstances } from "@lore/ship/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import type { Persona } from "../entities/personas.ts";
import { useCaseActors } from "../entities/useCaseActors.ts";
import { type UseCaseRun, useCaseRuns } from "../entities/useCaseRuns.ts";
import { type UseCase, useCases } from "../entities/useCases.ts";
import {
  orderReleases,
  releaseOfRun,
  retainedReleaseIds,
  type RunReleaseRow,
} from "../runReleases.ts";
import type {
  InsightRelease,
  PersonaAppCopy,
  PersonaChange,
  PersonaChanges,
  PersonaShowcase,
  ShowcaseItem,
} from "../schemas/personaInsightSchemas.ts";
import { RequirementsBuckets } from "./RequirementsBuckets.ts";
import { UseCaseService } from "./UseCaseService.ts";

/**
 * What a persona's page reads beyond the row (#E153): its scope changes
 * since its last run, where "Open as" leads, its showcase of recordings,
 * and the retention rule that keeps the evidence bucket from growing with
 * every release. All computed on read; nothing here is stored.
 */
export class PersonaInsightService {
  protected readonly actors = $repository(useCaseActors);
  protected readonly useCases = $repository(useCases);
  protected readonly runs = $repository(useCaseRuns);
  protected readonly quests = $repository(quests);
  protected readonly epics = $repository(epics);
  protected readonly releases = $repository(releases);
  protected readonly copies = $repository(appInstances);
  protected readonly links = $inject(ResourceLinkService);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly useCaseService = $inject(UseCaseService);
  protected readonly buckets = $inject(RequirementsBuckets);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly bound = $inject(BoundParameters);

  protected isRecording(mimeType: string): boolean {
    return mimeType.startsWith("video/");
  }

  /**
   * The live use cases the persona acts in.
   */
  public async useCasesOf(persona: Persona): Promise<UseCase[]> {
    const rows = await this.actors.findMany({
      where: { personaId: { eq: persona.id } },
      columns: ["useCaseId"],
    });
    const ids = [...new Set(rows.map((it) => it.useCaseId))];
    // Batched under D1's bind limit (#Q3959), then sorted whole.
    const found = await this.bound.collect(ids, (batch) =>
      this.useCases.findMany({ where: { id: { inArray: batch } } }),
    );
    return found.sort((a, b) => a.number - b.number);
  }

  protected async orderedReleases(projectId: number) {
    return orderReleases(
      await this.releases.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "number", "tag", "title", "releasedAt", "defaultSince"],
      }),
    );
  }

  protected toRelease(
    row: RunReleaseRow | undefined,
  ): InsightRelease | undefined {
    return row
      ? {
          id: row.id,
          tag: row.tag,
          title: row.title,
          releasedAt: row.releasedAt,
        }
      : undefined;
  }

  /**
   * The quests that touch a persona, completed: through an epic covering one
   * of its use cases, or a mention of it. Then those completed since its last
   * run, and every one of them grouped by release, newest first.
   */
  public async changesOf(persona: Persona): Promise<PersonaChanges> {
    const cases = await this.useCasesOf(persona);
    const caseIds = cases.map((it) => it.id);
    const [covers, mentions, lastRun, ordered] = await Promise.all([
      this.links.relationsTo("covers", "usecase", caseIds.map(String)),
      this.links.mentionsTo("persona", [String(persona.id)], "quest"),
      this.bound
        .collect(caseIds, (batch) =>
          this.runs.findMany({
            where: { useCaseId: { inArray: batch } },
            orderBy: [{ column: "ranAt", direction: "desc" }],
            columns: ["ranAt"],
            limit: 1,
          }),
        )
        .then((rows) => this.byRanAtDesc(rows).slice(0, 1)),
      this.orderedReleases(persona.projectId),
    ]);
    const epicIds = [...new Set(covers.map((it) => Number(it.fromId)))];
    const mentionIds = [...new Set(mentions.map((it) => Number(it.fromId)))];
    const [viaEpic, viaMention, epicRows] = await Promise.all([
      this.bound.collect(epicIds, (batch) =>
        this.quests.findMany({
          where: {
            projectId: { eq: persona.projectId },
            epicId: { inArray: batch },
            completedAt: { isNotNull: true },
          },
        }),
      ),
      this.bound.collect(mentionIds, (batch) =>
        this.quests.findMany({
          where: {
            projectId: { eq: persona.projectId },
            id: { inArray: batch },
            completedAt: { isNotNull: true },
          },
        }),
      ),
      this.bound.collect(epicIds, (batch) =>
        this.epics.findMany({
          where: { id: { inArray: batch } },
          columns: ["id", "number", "releaseId"],
        }),
      ),
    ]);
    const epicOf = new Map(epicRows.map((it) => [it.id, it]));
    const releaseOf = new Map(ordered.map((it) => [it.id, it]));

    const found = new Map<number, PersonaChange>();
    for (const [via, rows] of [
      ["epic", viaEpic],
      ["mention", viaMention],
    ] as const) {
      for (const quest of rows) {
        if (found.has(quest.id) || !quest.completedAt) continue;
        const epic = quest.epicId ? epicOf.get(quest.epicId) : undefined;
        const releaseId = quest.releaseId ?? epic?.releaseId;
        found.set(quest.id, {
          questNumber: quest.shortId,
          title: quest.title,
          completedAt: quest.completedAt,
          via,
          epicNumber: epic?.number,
          release: this.toRelease(
            releaseId ? releaseOf.get(releaseId) : undefined,
          ),
        });
      }
    }
    const all = [...found.values()].sort((a, b) =>
      b.completedAt.localeCompare(a.completedAt),
    );
    const lastRunAt = lastRun[0]?.ranAt;
    const changes = lastRunAt
      ? all.filter((it) => it.completedAt > lastRunAt)
      : [];

    let toReverify = 0;
    if (changes.length) {
      if (changes.some((it) => it.via === "mention")) {
        toReverify = cases.length;
      } else {
        const resources = await this.useCaseService.toResources(cases);
        toReverify = resources.filter((it) => it.stale).length;
      }
    }

    // What's new per release, newest first; the unreleased group first.
    const rank = new Map(ordered.map((it, index) => [it.id, index]));
    const groups = new Map<number, PersonaChange[]>();
    for (const change of all) {
      const key = change.release?.id ?? -1;
      groups.set(key, [...(groups.get(key) ?? []), change]);
    }
    const releasesOut = [...groups]
      .sort(
        ([a], [b]) =>
          (b === -1 ? Infinity : (rank.get(b) ?? 0)) -
          (a === -1 ? Infinity : (rank.get(a) ?? 0)),
      )
      .map(([key, list]) => ({
        release: key === -1 ? undefined : list[0].release,
        quests: list,
      }));

    return {
      lastRunAt,
      useCases: cases.length,
      toReverify,
      changes,
      releases: releasesOut,
    };
  }

  /**
   * Where "Open as" leads: the persona's app copy, looked up by its app and
   * env names. Never a production copy, and nothing without Ship.
   */
  public async appCopyOf(persona: Persona): Promise<PersonaAppCopy> {
    const app = persona.environmentApp;
    const env = persona.environmentEnv;
    if (!app || !env) return { state: "none", app, env };
    const capabilities = await this.security.capabilitiesOf(persona.projectId);
    if (!capabilities.ship) return { state: "ship_off", app, env };
    if (env === "production") return { state: "production", app, env };
    const [copy] = await this.copies.findMany({
      where: {
        projectId: { eq: persona.projectId },
        app: { eq: app },
        env: { eq: env },
      },
      columns: ["id", "url"],
      limit: 1,
    });
    if (!copy?.url) return { state: "missing", app, env };
    return { state: "ready", app, env, url: copy.url };
  }

  /**
   * The persona's showcase: per release, newest first, the latest run of
   * each of its use cases that holds a recording.
   */
  public async showcaseOf(persona: Persona): Promise<PersonaShowcase> {
    const cases = await this.useCasesOf(persona);
    if (cases.length === 0) return [];
    const [runs, ordered, resources] = await Promise.all([
      this.bound
        .collect(
          cases.map((it) => it.id),
          (batch) =>
            this.runs.findMany({
              where: { useCaseId: { inArray: batch } },
              orderBy: [{ column: "ranAt", direction: "desc" }],
            }),
        )
        .then((rows) => this.byRanAtDesc(rows)),
      this.orderedReleases(persona.projectId),
      this.useCaseService.toResources(cases),
    ]);
    const byCase = new Map(resources.map((it) => [it.id, it]));
    const rank = new Map(ordered.map((it, index) => [it.id, index]));
    const groups = new Map<
      number,
      { release?: InsightRelease; items: Map<number, ShowcaseItem> }
    >();
    for (const run of runs) {
      const recording = run.evidence.find((it) =>
        this.isRecording(it.mimeType),
      );
      if (!recording) continue;
      const release = releaseOfRun(ordered, run.ranAt);
      const key = release?.id ?? -1;
      const group = groups.get(key) ?? {
        release: this.toRelease(release),
        items: new Map(),
      };
      groups.set(key, group);
      // Runs come newest first: the first one seen is the latest.
      if (group.items.has(run.useCaseId)) continue;
      const useCase = byCase.get(run.useCaseId);
      if (!useCase) continue;
      group.items.set(run.useCaseId, {
        useCase: { number: useCase.number, title: useCase.title },
        runId: run.id,
        ranAt: run.ranAt,
        stale:
          run.scenarioVersion < useCase.scenarioVersion ||
          (useCase.lastRun?.id === run.id && useCase.stale),
        removed: !!recording.removedAt,
        file: recording.removedAt
          ? undefined
          : {
              fileId: recording.fileId,
              name: recording.name,
              mimeType: recording.mimeType,
            },
        chapters: useCase.steps.map((it) => ({
          position: it.position,
          text: it.text,
        })),
      });
    }
    return [...groups]
      .sort(
        ([a], [b]) =>
          (b === -1 ? Infinity : (rank.get(b) ?? 0)) -
          (a === -1 ? Infinity : (rank.get(a) ?? 0)),
      )
      .map(([, group]) => ({
        release: group.release,
        items: [...group.items.values()].sort(
          (a, b) => a.useCase.number - b.useCase.number,
        ),
      }));
  }

  /**
   * Evidence retention (owner, answer 76): files are kept for the current
   * release and the three before it, and within a release only for the
   * latest run of each use case. Every other file is deleted; the run stays,
   * with its results, and its evidence entry is stamped `removedAt`.
   * Returns how many files went.
   */
  public async pruneEvidence(projectId?: number): Promise<number> {
    const runs = await this.runs.findMany({
      where: {
        evidence: { like: '%"fileId"%' },
        ...(projectId ? { projectId: { eq: projectId } } : {}),
      },
      orderBy: [{ column: "ranAt", direction: "desc" }],
    });
    const byProject = new Map<number, UseCaseRun[]>();
    for (const run of runs) {
      byProject.set(run.projectId, [
        ...(byProject.get(run.projectId) ?? []),
        run,
      ]);
    }
    let removed = 0;
    const now = this.dt.nowISOString();
    for (const [project, list] of byProject) {
      const ordered = await this.orderedReleases(project);
      const kept = retainedReleaseIds(ordered);
      const latest = new Set<string>();
      for (const run of list) {
        const live = run.evidence.filter((it) => !it.removedAt);
        if (live.length === 0) continue;
        const release = releaseOfRun(ordered, run.ranAt);
        const key = `${release?.id ?? -1}:${run.useCaseId}`;
        const inWindow = !release || kept.has(release.id);
        const isLatest = !latest.has(key);
        latest.add(key);
        if (inWindow && isLatest) continue;
        const ids = live.map((it) => it.fileId);
        await this.buckets.evidence.deleteMany(ids);
        await this.runs.updateById(run.id, {
          evidence: run.evidence.map((it) =>
            it.removedAt ? it : { ...it, removedAt: now },
          ),
        });
        removed += ids.length;
      }
    }
    return removed;
  }

  /**
   * Newest first: rows read in batches come back newest first per batch
   * only (#Q3959).
   */
  protected byRanAtDesc<T extends { ranAt: string }>(rows: T[]): T[] {
    return rows.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  }
}
