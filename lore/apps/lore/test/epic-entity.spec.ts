import { Alepha } from "alepha";
import { describe, it } from "vitest";
import {
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

describe("epics entity", () => {
  it("orphans its quests on delete instead of deleting them", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    // Inject the exact fixture class (not a subclass) so the later
    // `alepha.inject(TestEntityRepositories)` calls inside
    // `createTestProject` / `createTestQuest` hit the cached instance
    // instead of `ContainerLockedError` — see the comment on
    // `TestEntityRepositories` for why every FK target needs registering
    // before `alepha.start()` in the first place.
    const app = alepha.inject(TestEntityRepositories);
    await alepha.start();

    const project = await createTestProject(alepha);
    const epic = await app.epics.create({
      projectId: project.id,
      number: 1,
      title: "Lore Deploy",
      description: "",
      status: "planned",
    });
    const quest = await createTestQuest(alepha, project, { epicId: epic.id });

    // `epics` carries `deletedAt`, so a plain `deleteById` soft-deletes
    // (an UPDATE) and never reaches SQLite's `ON DELETE SET NULL` — that
    // only fires on a physical `DELETE`, which `force: true` asks for.
    await app.epics.deleteById(epic.id, { force: true });

    const survivor = await app.quests.findById(quest.id);
    expect(survivor).toBeDefined();
    expect(survivor?.epicId).toBeUndefined();
  });
});
