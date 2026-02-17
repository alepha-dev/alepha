import { Alepha, t } from "alepha";
import { describe, expect, it } from "vitest";
import { $entity, $repository, db } from "../index.ts";

describe("$repository - save", () => {
  it("should save an entity with deleted fields", async () => {
    const dummies = $entity({
      name: "dummies",
      schema: t.object({
        id: db.primaryKey(),
        name: t.optional(t.text()),
      }),
    });

    class App {
      dummies = $repository(dummies);
    }

    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();

    // Create a new entity
    const entity = await app.dummies.create({ name: "Test" });
    expect(await app.dummies.getById(entity.id).then((it) => it.name)).toBe(
      "Test",
    );

    // Update the entity to set name to undefined (delete the field)
    entity.name = undefined;
    await app.dummies.save(entity);
    expect(entity.name).toBeUndefined();
    expect(
      await app.dummies.getById(entity.id).then((it) => it.name),
    ).toBeUndefined();
  });
});
