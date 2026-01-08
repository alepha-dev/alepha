import { Alepha, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";
import { $entity, $repository, DbEntityNotFoundError, pg } from "../index.ts";

describe("deletedAt", () => {
  const entity = $entity({
    name: "test_entity",
    schema: t.object({
      id: pg.primaryKey(),
      deletedAt: pg.deletedAt(),
      name: t.optional(t.text()),
    }),
  });

  class App {
    repository = $repository(entity);
  }

  const setup = async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    await alepha.start();
    const now = alepha.inject(DateTimeProvider).pause();
    return {
      repository: app.repository,
      now: now.toISOString(),
    };
  };

  it("should update instead of delete", async ({ expect }) => {
    const { repository, now } = await setup();

    await repository.createMany([{}, {}]);
    const entities = await repository.findMany();
    expect(entities.length).toEqual(2);
    expect(await repository.count()).toEqual(2);

    await repository.deleteById(entities[0].id);
    expect(await repository.count()).toEqual(1);
    expect(await repository.findMany()).toEqual([{ id: entities[1].id }]);

    expect(await repository.count({}, { force: true })).toEqual(2);
    expect(await repository.findMany({}, { force: true })).toEqual([
      { id: entities[1].id },
      { id: entities[0].id, deletedAt: now },
    ]);
  });

  it("should not update if deletedAt is already set", async ({ expect }) => {
    const { repository, now } = await setup();
    await repository.createMany([{}, {}]);
    const entities = await repository.findMany();
    const it = entities[0];
    await repository.destroy(it);
    it.name = "Toby";
    await expect(() => repository.save(it)).rejects.toThrow(
      DbEntityNotFoundError,
    );
    await repository.save(it, { force: true });
    expect(await repository.findById(it.id, { force: true })).toEqual({
      id: it.id,
      deletedAt: now,
      name: "Toby",
    });
  });

  it("should force delete", async ({ expect }) => {
    const { repository } = await setup();
    await repository.createMany([{}, {}]);
    const entities = await repository.findMany();
    const it = entities[0];
    await repository.destroy(it);
    expect(await repository.count()).toEqual(1);
    expect(await repository.count({}, { force: true })).toEqual(2);
    await repository.destroy(it, { force: true });
    expect(await repository.count()).toEqual(1);
    expect(await repository.count({}, { force: true })).toEqual(1);
  });
});
