import { type Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { expect } from "vitest";
import {
  $entity,
  $repository,
  DbEntityNotFoundError,
  db,
} from "../core/index.ts";

const entity = $entity({
  name: "test_entity",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    deletedAt: db.deletedAt(),
    name: z.text().optional(),
  }),
});

class App {
  repository = $repository(entity);
}

const setup = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const now = alepha.inject(DateTimeProvider).pause();
  return {
    repository: app.repository,
    now: now.toISOString(),
  };
};

export const testSoftDeleteUpdatesInsteadOfDelete = async (alepha: Alepha) => {
  const { repository, now } = await setup(alepha);

  await repository.createMany([{}, {}]);
  const entities = await repository.findMany();
  expect(entities.length).toEqual(2);
  expect(await repository.count()).toEqual(2);

  await repository.deleteById(entities[0].id);
  expect(await repository.count()).toEqual(1);
  expect(await repository.findMany()).toEqual([{ id: entities[1].id }]);

  expect(await repository.count({}, { force: true })).toEqual(2);
  const all = await repository.findMany({}, { force: true });
  expect(all).toEqual(
    expect.arrayContaining([
      { id: entities[1].id },
      { id: entities[0].id, deletedAt: now },
    ]),
  );
};

export const testNoUpdateIfAlreadyDeleted = async (alepha: Alepha) => {
  const { repository, now } = await setup(alepha);
  await repository.createMany([{}, {}]);
  const entities = await repository.findMany();
  const it = entities[0];
  await repository.destroy(it);
  it.name = "Toby";
  await expect(() => repository.save(it)).rejects.toThrow(
    DbEntityNotFoundError,
  );
  await repository.save(it, { force: true });
  expect(await repository.getById(it.id, { force: true })).toEqual({
    id: it.id,
    deletedAt: now,
    name: "Toby",
  });
};

export const testAggregateExcludesSoftDeleted = async (alepha: Alepha) => {
  const { repository } = await setup(alepha);
  await repository.createMany([{}, {}]);
  const entities = await repository.findMany();
  await repository.deleteById(entities[0].id);

  // An aggregate with NO where clause must still exclude soft-deleted rows.
  const result = await repository.aggregate({
    select: { id: { count: true } },
  });
  expect(Number(result[0].id.count)).toEqual(1);

  // ...unless force is set.
  const forced = await repository.aggregate(
    { select: { id: { count: true } } },
    { force: true },
  );
  expect(Number(forced[0].id.count)).toEqual(2);
};

export const testForceDelete = async (alepha: Alepha) => {
  const { repository } = await setup(alepha);
  await repository.createMany([{}, {}]);
  const entities = await repository.findMany();
  const it = entities[0];
  await repository.destroy(it);
  expect(await repository.count()).toEqual(1);
  expect(await repository.count({}, { force: true })).toEqual(2);
  await repository.destroy(it, { force: true });
  expect(await repository.count()).toEqual(1);
  expect(await repository.count({}, { force: true })).toEqual(1);
};
