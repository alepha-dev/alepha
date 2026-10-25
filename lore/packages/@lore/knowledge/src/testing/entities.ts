import type { Project } from "@lore/core/schemas";
import { CoreTestEntities } from "@lore/core/testing";
import { Alepha, type Infer } from "alepha";
import { $repository } from "alepha/orm";

import { folioDirectories } from "../api/entities/folioDirectories.ts";
import { type Folio, folios } from "../api/entities/folios.ts";

type FolioInsert = Infer<typeof folios.insertSchema>;

/**
 * Knowledge's repository bag (#E75, #Q2612): core's tables plus the folio's
 * own, `folios.directoryId` reaching `folio_directories`, constructed before
 * `start()` so the whole FK closure is registered up front.
 */
export class KnowledgeTestEntities extends CoreTestEntities {
  folios = $repository(folios);
  folioDirectories = $repository(folioDirectories);

  /**
   * The bag the container constructed when it holds the folio tables,
   * whichever class it is (the app's fixture combines every module's);
   * Knowledge's own otherwise.
   */
  public static override of(alepha: Alepha): KnowledgeTestEntities {
    const bag = CoreTestEntities.of(alepha) as Partial<KnowledgeTestEntities>;
    return bag.folios && bag.folioDirectories
      ? (bag as KnowledgeTestEntities)
      : alepha.inject(KnowledgeTestEntities);
  }
}

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
  const repo = KnowledgeTestEntities.of(alepha);
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
  const [row] = await CoreTestEntities.of(alepha).folioLinks.findMany({
    where: {
      fromType: { eq: "epic" },
      targetType: { eq: "folio" },
      toId: { eq: folioId },
      relation: { eq: "filed" },
    },
  });
  return row ? Number(row.fromId) : undefined;
};
