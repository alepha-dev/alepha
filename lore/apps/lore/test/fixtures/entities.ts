import { type Project } from "@lore/core/schemas";
import type { Alepha, Infer } from "alepha";
import { $repository } from "alepha/orm";

import { folioDirectories } from "@/api/entities/folioDirectories.ts";
import { type Folio, folios } from "@/api/entities/folios.ts";

type FolioInsert = Infer<typeof folios.insertSchema>;

/**
 * Repository bag backing the `createTest*` helpers below, and the thing a
 * spec needs to construct BEFORE `alepha.start()`.
 *
 * `$entity`'s `db.ref` foreign keys are resolved once, when the database is
 * synchronized at boot — and only against tables whose `Repository` has
 * already been constructed by then (each `Repository` registers its own
 * table with the provider from its constructor). `quests` alone reaches
 * `projects`, `releases`, `feedback` and `users` via FK columns, so a spec
 * that only wires up `epics` + `quests` before `start()` and creates a
 * `quests` row afterwards through `createTestQuest` fails at boot with
 * "Referenced table X not found" — not at the call site that actually
 * needed it.
 *
 * A spec using any `createTest*` helper below should give its own
 * pre-`start()` class every field this class has (or `extends` it), so the
 * whole FK closure gets registered up front.
 */
import { WorkTestEntities } from "@lore/work/testing";

export { createTestEpic, createTestQuest } from "@lore/work/testing";

export {
  createTestMember,
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";

export class TestEntityRepositories extends WorkTestEntities {
  folios = $repository(folios);
  // `folios.directoryId` refs this table: needed pre-`start()` whenever
  // `folios` is, for the same reason `quests`'s own FK closure is.
  folioDirectories = $repository(folioDirectories);
}

/**
 * These counters make fixture rows unique (project titles, quest `shortId`,
 * epic `number` all carry a `(projectId, ...)` unique index). A single
 * monotonic counter per entity is enough: it never repeats within a
 * process, so it never collides within any one project either. It does NOT
 * reproduce the real per-project 1-based numbering the app allocates via
 * `$sequence` — tests that care about that allocate their own numbers
 * through the real controller/service instead of these fixtures.
 */
let folioSeq = 0;

/**
 * Creates a folio directly through the repository, bypassing
 * `FolioController` (auth, `$sequence`-allocated `shortId`, search-text
 * indexing, link sync). Fine for tests that only need a valid folio row
 * to attach/detach or hang other assertions off.
 */
export const createTestFolio = async (
  alepha: Alepha,
  project: Pick<Project, "id" | "createdBy" | "organizationId">,
  overrides: Partial<FolioInsert> & { epicId?: number } = {},
): Promise<Folio & { epicId?: number }> => {
  const repo = alepha.inject(TestEntityRepositories);
  folioSeq += 1;
  // `epicId` is a filing, which lives in core's link graph rather than on
  // the folio (#Q2626): it becomes a `filed` row, never the column.
  const { epicId, ...rest } = overrides;
  const folio = await repo.folios.create({
    ...rest,
    // Spread first, defaults last — see `createTestProject`.
    projectId: overrides.projectId ?? project.id,
    shortId: overrides.shortId ?? folioSeq,
    title: overrides.title ?? `Test Folio ${folioSeq}`,
  });
  if (epicId == null) return folio;
  await repo.folioLinks.create({
    fromType: "epic",
    fromId: String(epicId),
    targetType: "folio",
    toId: folio.id,
    relation: "filed",
  });
  return { ...folio, epicId };
};

/**
 * The epic a folio is filed under, read from core's link graph (#Q2626):
 * what a spec asserts where it used to read `folios.epicId`.
 */
export const filedEpicOf = async (
  alepha: Alepha,
  folioId: string,
): Promise<number | undefined> => {
  const [row] = await alepha
    .inject(TestEntityRepositories)
    .folioLinks.findMany({
      where: {
        fromType: { eq: "epic" },
        targetType: { eq: "folio" },
        toId: { eq: folioId },
        relation: { eq: "filed" },
      },
    });
  return row ? Number(row.fromId) : undefined;
};
