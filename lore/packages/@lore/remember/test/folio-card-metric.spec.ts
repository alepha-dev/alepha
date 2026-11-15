import {
  type DashboardResolvable,
  ProjectDashboardCardService,
} from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FolioTableService, LoreRememberApi } from "../src/api/index.ts";
import { FolioCardMetric } from "../src/api/services/FolioCardMetric.ts";
import {
  createTestFolio,
  createTestProject,
  KnowledgeTestEntities,
} from "../src/testing/index.ts";

/**
 * The Folio card (#E144, #Q3520): what each kind of folio resolves to, the
 * three answers kept apart, and every card of a board in one batch.
 */
describe("FolioCardMetric", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreRememberApi);
    alepha.inject(KnowledgeTestEntities);
    await alepha.start();
    await alepha
      .inject(DateTimeProvider)
      .travel(
        new Date("2026-11-15T09:00:00.000Z").getTime() -
          alepha.inject(DateTimeProvider).nowMillis(),
      );
  });

  afterEach(async () => {
    await alepha.stop();
  });

  let cardId = 0;
  const card = (
    project: { id: number; slug?: string },
    filters: Record<string, unknown>,
  ): DashboardResolvable =>
    ({
      card: { id: ++cardId, metric: "folio", filters },
      scope: { projects: [{ id: project.id, slug: project.slug ?? "p" }] },
      filters,
      windowDays: 7,
    }) as unknown as DashboardResolvable;

  const resolve = (cards: DashboardResolvable[]) =>
    alepha.inject(FolioCardMetric).resolveAll(cards);

  const table = async (
    project: Awaited<ReturnType<typeof createTestProject>>,
    rows: Array<Record<string, unknown>>,
  ) => {
    const folio = await createTestFolio(alepha, project, { type: "table" });
    const tables = alepha.inject(FolioTableService);
    await tables.seedColumns(folio, [
      { name: "Goal", type: "text" },
      { name: "Due", type: "date" },
      { name: "Done", type: "checkbox" },
      { name: "Owner", type: "text" },
      { name: "Fifth", type: "text" },
    ]);
    if (rows.length)
      await tables.addRows(
        folio,
        rows.map((cells) => ({ cells })),
      );
    return folio;
  };

  it("shows a text folio as a note, cut at a block boundary with Read more", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const long = Array.from(
      { length: 20 },
      (_, i) => `## Part ${i}\n\nParagraph ${i} ${"word ".repeat(10)}`,
    ).join("\n\n");
    const short = await createTestFolio(alepha, project, { content: "Short." });
    const cut = await createTestFolio(alepha, project, { content: long });
    const [a, b] = [
      card(project, { folio: short.shortId, show: "auto" }),
      card(project, { folio: cut.shortId, show: "auto" }),
    ];
    const out = await resolve([a, b]);
    expect(out.get(a.card.id)).toMatchObject({
      presentation: "note",
      detail: { markdown: "Short.", more: false },
      link: { route: "projectFoliosFolio" },
    });
    const value = out.get(b.card.id)!;
    expect(value.detail.more).toBe(true);
    const markdown = String(value.detail.markdown);
    expect(markdown.length).toBeLessThanOrEqual(FolioCardMetric.NOTE_CHARS);
    expect(long.startsWith(markdown)).toBe(true);
    expect(long.slice(markdown.length, markdown.length + 2)).toBe("\n\n");
  });

  it("shows a table's first rows in position order, four columns at most", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const folio = await table(project, [
      { Goal: "a", Done: true, Owner: "me", Fifth: "x" },
      { Goal: "b" },
      { Goal: "c" },
    ]);
    const entry = card(project, {
      folio: folio.shortId,
      show: "auto",
      limit: 3,
    });
    const value = (await resolve([entry])).get(entry.card.id)!;
    expect(value.presentation).toBe("table");
    expect(value.detail.columns).toEqual(["Goal", "Due", "Done", "Owner"]);
    expect(value.detail.cells).toEqual([
      ["a", "", "✓", "me"],
      ["b", "", "", ""],
      ["c", "", "", ""],
    ]);
  });

  it("shows what comes next from today on, today first, for a table read as a calendar", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const folio = await table(project, [
      { Goal: "past", Due: "2026-11-01" },
      { Goal: "later", Due: "2026-12-01" },
      { Goal: "today", Due: "2026-11-15" },
      { Goal: "soon", Due: "2026-11-20" },
    ]);
    await alepha.inject(FolioTableService).setView(folio, { kind: "calendar" });
    const entry = card(project, {
      folio: folio.shortId,
      show: "auto",
      limit: 3,
    });
    const value = (await resolve([entry])).get(entry.card.id)!;
    expect(value.presentation).toBe("feed");
    expect(value.rows?.map((row) => row.title)).toEqual([
      "today",
      "soon",
      "later",
    ]);
    expect(value.rows?.[0].at).toBe("2026-11-15T12:00:00.000Z");
  });

  it("keeps empty, no folio and a failure apart", async ({ expect }) => {
    const project = await createTestProject(alepha);
    const empty = await table(project, []);
    const past = await table(project, [{ Goal: "old", Due: "2026-01-01" }]);
    const locked = await createTestFolio(alepha, project, {
      protected: true,
      content: "{}",
    });
    const cards = [
      card(project, { folio: empty.shortId, show: "rows" }),
      card(project, { folio: past.shortId, show: "upcoming" }),
      card(project, { folio: locked.shortId, show: "auto" }),
      card(project, { folio: 9999, show: "auto" }),
      card(project, { folio: 0, show: "auto" }),
    ];
    const out = await resolve(cards);
    expect(cards.map((it) => out.get(it.card.id)?.empty)).toEqual([
      "noRows",
      "nothingAhead",
      "noFolio",
      "noFolio",
      "noFolio",
    ]);
  });

  it("refuses a card on an encrypted folio when it is saved, and keeps one on a readable folio", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const locked = await createTestFolio(alepha, project, {
      protected: true,
      content: "{}",
    });
    const open = await createTestFolio(alepha, project, { content: "Hi" });
    const cards = alepha.inject(ProjectDashboardCardService);
    const scope = { kind: "projects" as const, projectIds: [project.id] };

    await expect(
      cards.add(project.id, undefined, {
        metric: "folio",
        scope,
        filters: { folio: locked.shortId },
      }),
    ).rejects.toThrow(/encrypted/);
    const kept = await cards.add(project.id, undefined, {
      metric: "folio",
      scope,
      filters: { folio: open.shortId },
    });
    await expect(
      cards.update(project.id, kept.id, {
        filters: { folio: locked.shortId },
      }),
    ).rejects.toThrow(/encrypted/);
    expect(
      (await cards.list(project.id)).map((it) => it.filters.folio),
    ).toEqual([open.shortId]);
  });

  it("resolves every card of a board in one read of each table", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const one = await table(project, [{ Goal: "a" }]);
    const two = await table(project, [{ Goal: "b" }]);
    const note = await createTestFolio(alepha, project, { content: "Hi" });
    const reads = new Map<string, number>();
    alepha.events.on("repository:read:before", (event) => {
      reads.set(event.tableName, (reads.get(event.tableName) ?? 0) + 1);
    });
    await resolve([
      card(project, { folio: one.shortId }),
      card(project, { folio: two.shortId }),
      card(project, { folio: note.shortId }),
      card(project, { folio: one.shortId, show: "rows" }),
    ]);
    expect(reads.get("folios")).toBe(1);
    expect(reads.get("folio_rows")).toBe(1);
    expect(reads.get("folio_columns")).toBe(1);
    expect(reads.get("folio_views")).toBe(1);
  });
});
