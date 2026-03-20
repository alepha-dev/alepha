import { type Alepha, t } from "alepha";
import { currentUserAtom } from "alepha/security";
import { expect } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";

const entity = $entity({
  name: "test_org_entity",
  schema: t.object({
    id: db.primaryKey(),
    organization: db.organization(),
    name: t.optional(t.text()),
  }),
});

class App {
  repository = $repository(entity);
}

const setup = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  return { repository: app.repository, alepha };
};

export const testOrgUserSeesOwnAndGlobalRows = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setup(alepha);

  // Create rows for org-a, org-b, and global (null)
  await repository.create({
    name: "org-a-row",
    organization: "a0000000-0000-0000-0000-000000000001",
  });
  await repository.create({
    name: "org-b-row",
    organization: "b0000000-0000-0000-0000-000000000002",
  });
  await repository.create({ name: "global-row" });

  // User in org-a should see org-a + global
  app.store.set(currentUserAtom, {
    id: "user-1",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  const results = await repository.findMany();
  expect(results).toHaveLength(2);
  expect(results.map((r: any) => r.name).sort()).toEqual([
    "global-row",
    "org-a-row",
  ]);

  // Count should also be filtered
  expect(await repository.count()).toEqual(2);
};

export const testMasterUserSeesEverything = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setup(alepha);

  await repository.create({
    name: "org-a-row",
    organization: "a0000000-0000-0000-0000-000000000001",
  });
  await repository.create({
    name: "org-b-row",
    organization: "b0000000-0000-0000-0000-000000000002",
  });
  await repository.create({ name: "global-row" });

  // Master user (no org) sees everything
  app.store.set(currentUserAtom, {
    id: "master-user",
  });

  const results = await repository.findMany();
  expect(results).toHaveLength(3);
  expect(await repository.count()).toEqual(3);
};

export const testNoUserSeesEverything = async (alepha: Alepha) => {
  const { repository } = await setup(alepha);

  await repository.create({
    name: "org-a-row",
    organization: "a0000000-0000-0000-0000-000000000001",
  });
  await repository.create({ name: "global-row" });

  // No user in context = no filter
  const results = await repository.findMany();
  expect(results).toHaveLength(2);
};

export const testAutoStampOnCreate = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setup(alepha);

  app.store.set(currentUserAtom, {
    id: "user-1",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  // Create without specifying organization — should be auto-stamped
  const entity = await repository.create({ name: "auto-stamped" });
  expect(entity.organization).toEqual("a0000000-0000-0000-0000-000000000001");
};

export const testAutoStampNullForMasterUser = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setup(alepha);

  app.store.set(currentUserAtom, {
    id: "master-user",
  });

  // Master user creates a row — org stays null (global)
  const entity = await repository.create({ name: "master-row" });
  expect(entity.organization).toBeUndefined();
};

export const testAutoStampDoesNotOverrideExplicit = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setup(alepha);

  app.store.set(currentUserAtom, {
    id: "user-1",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  // Explicitly set organization — should not be overridden
  const entity = await repository.create({
    name: "explicit-org",
    organization: "b0000000-0000-0000-0000-000000000002",
  });
  expect(entity.organization).toEqual("b0000000-0000-0000-0000-000000000002");
};

export const testAutoStampOnCreateMany = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setup(alepha);

  app.store.set(currentUserAtom, {
    id: "user-1",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  const entities = await repository.createMany([
    { name: "row-1" },
    { name: "row-2" },
  ]);
  expect(entities[0].organization).toEqual(
    "a0000000-0000-0000-0000-000000000001",
  );
  expect(entities[1].organization).toEqual(
    "a0000000-0000-0000-0000-000000000001",
  );
};

export const testOrgFilterOnUpdateOne = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setup(alepha);

  const row = await repository.create({
    name: "org-b-row",
    organization: "b0000000-0000-0000-0000-000000000002",
  });

  // User in org-a cannot update org-b row
  app.store.set(currentUserAtom, {
    id: "user-1",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  const updated = await repository.updateMany(
    { id: { eq: row.id } },
    { name: "hacked" },
  );
  expect(updated).toHaveLength(0);

  // Verify row is unchanged (read as master)
  app.store.set(currentUserAtom, { id: "master" });
  const check = await repository.getById(row.id);
  expect(check.name).toEqual("org-b-row");
};

export const testOrgFilterOnDelete = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setup(alepha);

  const row = await repository.create({
    name: "org-b-row",
    organization: "b0000000-0000-0000-0000-000000000002",
  });

  // User in org-a cannot delete org-b row
  app.store.set(currentUserAtom, {
    id: "user-1",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  const deleted = await repository.deleteMany({ id: { eq: row.id } });
  expect(deleted).toHaveLength(0);

  // Verify row still exists
  app.store.set(currentUserAtom, { id: "master" });
  expect(await repository.count()).toEqual(1);
};
