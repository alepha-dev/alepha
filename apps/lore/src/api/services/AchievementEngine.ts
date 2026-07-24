import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { Character } from "../entities/characters.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";

/**
 * Server-evaluated, badge-only character achievements. Granted keys are
 * appended to `characters.achievements` (idempotent). See folio
 * "Character — vision and economy" for the design.
 *
 * v1 ships two example achievements — one per event class — to validate
 * the wiring end-to-end. Adding more is a registry edit; no schema work
 * required.
 */
export type AchievementEventType =
  | "quest.completed"
  | "character.created"
  | "folio.saved"
  | "zone.created";

export interface AchievementEvent {
  type: AchievementEventType;
}

export interface AchievementContext {
  /** The character we are evaluating predicates against. */
  character: Character;
  /** Zone keys configured on the campaign at evaluation time. */
  campaignZones: string[];
}

export interface AchievementDefinition {
  key: string;
  label: string;
  description: string;
  /** Lucide icon name (resolved client-side to a React component). */
  icon: string;
  /** Goal count — Steam-style "X / target" denominator. */
  target: number;
  /** Events this predicate cares about — gates the per-event evaluation pass. */
  events: ReadonlyArray<AchievementEventType>;
  predicate(
    ctx: AchievementContext,
    engine: AchievementEngine,
  ): Promise<boolean>;
  /**
   * Current count toward `target`. The catalog endpoint uses this to
   * show a progress bar even when the achievement is still locked.
   */
  progress(ctx: AchievementContext, engine: AchievementEngine): Promise<number>;
}

/** Public projection used by `list()` + the catalog API. */
export interface AchievementCatalogEntry {
  key: string;
  label: string;
  description: string;
  icon: string;
  target: number;
}

export class AchievementEngine {
  log = $logger();
  protected questsRepo = $repository(quests);
  protected foliosRepo = $repository(folios);

  protected registry: readonly AchievementDefinition[] = [
    {
      key: "hard_worker",
      label: "Hard Worker",
      description: "Complete 10 quests.",
      icon: "Award",
      target: 10,
      events: ["quest.completed"],
      progress: async ({ character }, engine) =>
        engine.completedCount(character),
      predicate: async ({ character }, engine) =>
        (await engine.completedCount(character)) >= 10,
    },
    {
      key: "bookkeeper",
      label: "Bookkeeper",
      description: "Reach 5 folios in this campaign.",
      icon: "BookOpen",
      target: 5,
      events: ["folio.saved"],
      progress: async ({ character }, engine) => engine.folioCount(character),
      predicate: async ({ character }, engine) =>
        (await engine.folioCount(character)) >= 5,
    },
  ];

  /**
   * Evaluate every predicate registered for `event` against the current
   * state. Returns the keys that are now true AND not yet on the character.
   * Caller is responsible for persisting the result via `grant`.
   */
  async evaluate(
    event: AchievementEvent,
    ctx: AchievementContext,
  ): Promise<string[]> {
    const already = new Set(ctx.character.achievements ?? []);
    const granted: string[] = [];
    for (const def of this.registry) {
      if (!def.events.includes(event.type)) continue;
      if (already.has(def.key)) continue;
      try {
        if (await def.predicate(ctx, this)) {
          granted.push(def.key);
        }
      } catch (err) {
        // A buggy predicate must never block the surrounding write — log
        // and skip. The character keeps their XP / gold etc.
        this.log.warn(
          `achievement predicate '${def.key}' threw: ${String(err)}`,
        );
      }
    }
    return granted;
  }

  /**
   * Event-agnostic reconciliation: run every predicate against the
   * current state. Returns keys that are now true AND not yet on the
   * character. Used by the catalog endpoint to heal stale state — e.g.
   * when a character crossed a threshold before the achievement was
   * registered, or before the matching event hook was wired in.
   */
  async evaluateAll(ctx: AchievementContext): Promise<string[]> {
    const already = new Set(ctx.character.achievements ?? []);
    const granted: string[] = [];
    for (const def of this.registry) {
      if (already.has(def.key)) continue;
      try {
        if (await def.predicate(ctx, this)) {
          granted.push(def.key);
        }
      } catch (err) {
        this.log.warn(
          `achievement predicate '${def.key}' threw: ${String(err)}`,
        );
      }
    }
    return granted;
  }

  /**
   * Idempotent append. Returns the new (de-duplicated) achievements array.
   * Caller persists. No-op when `keys` is empty.
   */
  grant(character: Character, keys: readonly string[]): string[] {
    const out = [...(character.achievements ?? [])];
    for (const key of keys) {
      if (!out.includes(key)) out.push(key);
    }
    return out;
  }

  /** Public catalog — what the My Character page lists. */
  list(): readonly AchievementCatalogEntry[] {
    return this.registry.map(({ key, label, description, icon, target }) => ({
      key,
      label,
      description,
      icon,
      target,
    }));
  }

  // Internal helpers used by predicates — exposed because predicates are
  // defined outside the class body.
  async completedCount(character: Character): Promise<number> {
    return (await this.completedQuests(character)).length;
  }

  async completedQuests(character: Character) {
    return this.questsRepo.findMany({
      where: {
        campaignId: { eq: character.campaignId },
        completedBy: { eq: character.userId },
        completedAt: { isNotNull: true },
      },
    });
  }

  async folioCount(character: Character): Promise<number> {
    const rows = await this.foliosRepo.findMany({
      where: { campaignId: { eq: character.campaignId } },
    });
    return rows.length;
  }

  /**
   * Compute the current count for each achievement, given a character +
   * its campaign context. Used by the catalog endpoint to render Steam-
   * style "X / target" progress bars on locked entries. Capped at
   * `target` so earned achievements always show "target / target".
   */
  async progressFor(ctx: AchievementContext): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const def of this.registry) {
      try {
        const current = await def.progress(ctx, this);
        out.set(def.key, Math.min(current, def.target));
      } catch (err) {
        this.log.warn(
          `achievement progress '${def.key}' threw: ${String(err)}`,
        );
        out.set(def.key, 0);
      }
    }
    return out;
  }
}
