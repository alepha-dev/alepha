import type { Project } from "@lore/core/schemas";
import { CoreTestEntities } from "@lore/core/testing";
import { Alepha, type Infer } from "alepha";
import { $repository } from "alepha/orm";

import { areas } from "../api/entities/areas.ts";
import { type Epic, epics } from "../api/entities/epics.ts";
import { feedback } from "../api/entities/feedback.ts";
import {
  type Quest,
  type QuestInsert,
  quests,
} from "../api/entities/quests.ts";
import { releases } from "../api/entities/releases.ts";

type EpicInsert = Infer<typeof epics.insertSchema>;

/**
 * Work's repository bag (#E75, #Q2613): core's tables plus the ones a quest
 * reaches through its foreign keys (`releases`, `feedback`, `areas`,
 * `epics`), constructed before `start()` so the whole FK closure is
 * registered up front. The app's fixture extends it with Knowledge's tables.
 */
export class WorkTestEntities extends CoreTestEntities {
  releases = $repository(releases);
  feedback = $repository(feedback);
  areas = $repository(areas);
  epics = $repository(epics);
  quests = $repository(quests);

  /**
   * The bag the container constructed, when it is a Work one or a subclass
   * of it; Work's own otherwise.
   */
  public static override of(alepha: Alepha): WorkTestEntities {
    const bag = CoreTestEntities.of(alepha);
    return bag instanceof WorkTestEntities
      ? bag
      : alepha.inject(WorkTestEntities);
  }
}

let questSeq = 0;
let epicSeq = 0;

/**
 * Creates a quest directly through the repository, bypassing
 * `QuestController` / `QuestService` (auth, `$sequence`-allocated `shortId`,
 * area bookkeeping). `createdBy` defaults to the project's own owner so
 * callers that don't care about attribution don't have to invent a user.
 */
export const createTestQuest = async (
  alepha: Alepha,
  project: Pick<Project, "id" | "createdBy" | "organizationId">,
  overrides: Partial<QuestInsert> = {},
): Promise<Quest> => {
  const repo = WorkTestEntities.of(alepha);
  questSeq += 1;
  return repo.quests.create({
    ...overrides,
    // Spread first, defaults last — see `createTestProject`. `history`
    // needs the same treatment as the other required fields below even
    // though it looks defaultable: it is a plain `z.array().default([])`,
    // not `db.default(...)`, so `QuestInsert` does not mark it optional.
    shortId: overrides.shortId ?? questSeq,
    title: overrides.title ?? `Test Quest ${questSeq}`,
    description: overrides.description ?? "",
    area: overrides.area ?? "general",
    priority: overrides.priority ?? "medium",
    projectId: overrides.projectId ?? project.id,
    createdBy: overrides.createdBy ?? project.createdBy,
    history: overrides.history ?? [],
  });
};

/**
 * Creates an epic directly through the repository, bypassing
 * `EpicController` and its `$sequence`-allocated `number`.
 */
export const createTestEpic = async (
  alepha: Alepha,
  project: Pick<Project, "id" | "createdBy" | "organizationId">,
  overrides: Partial<EpicInsert> = {},
): Promise<Epic> => {
  const repo = WorkTestEntities.of(alepha);
  epicSeq += 1;
  return repo.epics.create({
    ...overrides,
    // Spread first, defaults last — see `createTestProject`.
    projectId: overrides.projectId ?? project.id,
    number: overrides.number ?? epicSeq,
    title: overrides.title ?? `Test Epic ${epicSeq}`,
    description: overrides.description ?? "",
    status: overrides.status ?? "draft",
  });
};
