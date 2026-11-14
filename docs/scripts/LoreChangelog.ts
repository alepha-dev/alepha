import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { $logger } from "alepha/logger";

import type {
  ChangelogChange,
  ChangelogEntry,
  ChangelogGroup,
} from "./interfaces.ts";

/**
 * The changelog page's data, read from the published Lore releases (#Q3638).
 *
 * The Lore release is the changelog: one release per version, its epics, then
 * the quests that belong to no epic grouped under the area they were done in.
 * Until #Q3638 the page parsed the framework's `CHANGELOG.md` instead, a file
 * the Release workflow committed to `main` on every release, which a
 * protected `main` no longer allows.
 *
 * Read through the same two endpoints Lore's own release page uses:
 * `getReleaseChangelog` for the frozen groups a published release keeps, and
 * `getReleaseContents` for each quest's area, which the groups do not carry
 * and the scope filter needs.
 *
 * ⚠️ **No Lore reference reaches the page.** A quest's number and its link are
 * planning records, and the site is user documentation: the page shows each
 * quest's title and area, never its `#Q`.
 *
 * ⚠️ **A build without `LORE_API_KEY` still builds.** A contributor's machine
 * and a fork's pull request have no key, so the page falls back to the
 * sample in `changelog.sample.json`, logged as such. CI passes the key, so
 * what deploys is always the real history.
 */
export class LoreChangelog {
  protected log = $logger();

  /**
   * The Lore project holding the framework's, Lore's and Bay's releases,
   * addressed by id because that is the durable reference: its slug follows
   * its title.
   */
  public static readonly PROJECT_ID = 1;

  /**
   * How many published releases the page carries: the page shows ten, and
   * reading more would only fetch what it drops.
   */
  public static readonly RELEASE_LIMIT = 10;

  public static readonly DEFAULT_URL = "https://lore.alepha.dev";

  /**
   * The published releases, newest first, or the sample when no key is set.
   */
  public async read(
    env: Record<string, string | undefined> = process.env,
    fetcher: LoreFetch = fetch,
  ): Promise<ChangelogEntry[]> {
    const key = env.LORE_API_KEY;
    if (!key) {
      this.log.warn(
        "LORE_API_KEY is not set: the changelog page shows the sample releases",
      );
      return this.sample();
    }

    const base = (env.LORE_URL || LoreChangelog.DEFAULT_URL).replace(
      /\/+$/,
      "",
    );
    const get = async <T>(path: string): Promise<T> => {
      const response = await fetcher(`${base}/api${path}`, {
        headers: { authorization: `Bearer ${key}` },
      });
      if (!response.ok) {
        throw new Error(
          `Lore answered ${response.status} to GET /api${path}: the changelog cannot be built`,
        );
      }
      return (await response.json()) as T;
    };

    const releases = await get<LoreRelease[]>(
      `/getReleases/${LoreChangelog.PROJECT_ID}`,
    );
    const published = releases
      .filter((release) => release.releasedAt && release.tag)
      .sort((a, b) => b.releasedAt!.localeCompare(a.releasedAt!))
      .slice(0, LoreChangelog.RELEASE_LIMIT);

    const entries = await Promise.all(
      published.map(async (release) => {
        const [changelog, contents] = await Promise.all([
          get<LoreReleaseChangelog>(`/getReleaseChangelog/${release.id}`),
          get<LoreReleaseContents>(`/getReleaseContents/${release.id}`),
        ]);
        return this.toEntry(release, changelog, contents);
      }),
    );

    this.log.debug(`Read ${entries.length} published releases from Lore`);
    return entries;
  }

  /**
   * One release as the page shows it. The epic groups first, as Lore orders
   * them, then the area groups.
   */
  public toEntry(
    release: LoreRelease,
    changelog: LoreReleaseChangelog,
    contents: LoreReleaseContents,
  ): ChangelogEntry {
    const areas = new Map<number, string | undefined>();
    for (const quest of [
      ...contents.epics.flatMap((epic) => epic.quests),
      ...contents.looseQuests,
    ]) {
      areas.set(quest.shortId, quest.area ?? undefined);
    }

    // ⚠️ Keyed on what the page shows, so two Lore groups that read the same
    // become one. Lore has both a `cli` and an `alepha/cli` area, which are
    // both `cli` here: two sections of one name in one release, and the page
    // keys a section by its name. React then kept a stale row on screen when
    // the scope filter removed one of them.
    const groups = new Map<string, ChangelogGroup>();
    for (const group of changelog.groups) {
      const name =
        group.kind === "area" ? this.scopeOf(group.name) : group.name;
      const changes = group.quests.map((quest): ChangelogChange => ({
        scope: this.scopeOf(
          areas.get(quest.shortId) ??
            (group.kind === "area" ? group.name : undefined),
        ),
        message: quest.title,
      }));
      if (changes.length === 0) continue;
      const key = `${group.kind}:${name}`;
      const existing = groups.get(key);
      if (existing) {
        existing.changes.push(...changes);
      } else {
        groups.set(key, { kind: group.kind, name, changes });
      }
    }

    return {
      version: release.tag!,
      date: release.releasedAt!.slice(0, 10),
      groups: [...groups.values()],
    };
  }

  /**
   * A Lore area as the page's scope: the module path, without the package
   * prefix every framework area carries. `alepha/api/users` is `api/users`,
   * `@alepha/ui` is `ui`, `lore/quests` and `bay` stay as they are, so the
   * scope filter's groups (`cli`, `ui`, `lore`, `bay`) read them unchanged.
   */
  public scopeOf(area: string | undefined): string {
    if (!area || area === "Uncategorized") return "misc";
    const scope = area.replace(/^@alepha\//, "").replace(/^alepha\//, "");
    return scope === "alepha" ? "core" : scope.toLowerCase();
  }

  /**
   * What a build without a key renders: a few releases in the shape the real
   * ones take, so the page and its e2e suite still have something to show.
   */
  public async sample(): Promise<ChangelogEntry[]> {
    const raw = await readFile(
      join(import.meta.dirname, "changelog.sample.json"),
      "utf-8",
    );
    return JSON.parse(raw) as ChangelogEntry[];
  }
}

/**
 * The fields of Lore's release endpoints this reads. Declared here rather than
 * imported: the `lore` workspace is private, and the docs build only needs
 * these few.
 */
/**
 * The one part of `fetch` the reader uses, so a spec can hand it a function.
 */
export type LoreFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface LoreRelease {
  id: number;
  tag?: string;
  releasedAt?: string;
}

export interface LoreReleaseChangelog {
  groups: Array<{
    kind: "epic" | "area";
    name: string;
    quests: Array<{ shortId: number; title: string }>;
  }>;
}

export interface LoreReleaseContents {
  epics: Array<{ quests: Array<{ shortId: number; area?: string | null }> }>;
  looseQuests: Array<{ shortId: number; area?: string | null }>;
}
