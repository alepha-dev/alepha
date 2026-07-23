import { type Alepha, AlephaError, z } from "alepha";
import { currentUserAtom } from "alepha/security";
import { expect } from "vitest";
import { $entity, $repository, db } from "../core/index.ts";

const entity = $entity({
  name: "test_org_entity",
  schema: z.object({
    id: db.primaryKey(),
    organization: db.organization(),
    name: z.text().optional(),
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

// A tenant-scoped entity that opts into fail-closed semantics: no "global
// row" visibility (the `IS NULL` escape is dropped) and queries/inserts with
// no resolved tenant are refused rather than silently seeing/writing everything.
// `nullable: true` is kept so a NULL row CAN be written directly (legacy data),
// which lets us prove such a row is invisible to a scoped tenant.
const strictEntity = $entity({
  name: "test_org_strict_entity",
  schema: z.object({
    id: db.primaryKey(),
    organization: db.organization({ strict: true, nullable: true }),
    name: z.text().optional(),
  }),
});

// A NON-strict view over the SAME physical table, used only to seed a legacy
// NULL/global row — something a strict repository (correctly) refuses to write.
// It lets us prove such a pre-existing row is invisible to a scoped tenant.
const strictSeedEntity = $entity({
  name: "test_org_strict_entity",
  schema: z.object({
    id: db.primaryKey(),
    organization: db.organization(),
    name: z.text().optional(),
  }),
});

class StrictApp {
  repository = $repository(strictEntity);
  seed = $repository(strictSeedEntity);
}

// Org-scoped entity whose unique key (`code`) is tenant-agnostic — the exact
// shape where an unscoped upsert could overwrite another tenant's row.
const upsertEntity = $entity({
  name: "test_org_upsert_entity",
  schema: z.object({
    id: db.primaryKey(),
    organization: db.organization(),
    code: z.text(),
    name: z.text().optional(),
  }),
  indexes: [{ column: "code", unique: true }],
});

class UpsertApp {
  repository = $repository(upsertEntity);
}

const setupUpsert = async (alepha: Alepha) => {
  const app = alepha.inject(UpsertApp);
  await alepha.start();
  return { repository: app.repository, alepha };
};

const setupStrict = async (alepha: Alepha) => {
  const app = alepha.inject(StrictApp);
  await alepha.start();
  return { repository: app.repository, seed: app.seed, alepha };
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

export const testStrictHidesGlobalRows = async (alepha: Alepha) => {
  const { repository, seed, alepha: app } = await setupStrict(alepha);

  await repository.create({
    name: "org-a-row",
    organization: "a0000000-0000-0000-0000-000000000001",
  });
  await repository.create({
    name: "org-b-row",
    organization: "b0000000-0000-0000-0000-000000000002",
  });
  // A NULL/global row exists (e.g. legacy data written before the table was
  // made strict) — seeded via the non-strict view over the same table.
  await seed.create({ name: "global-row" });

  app.store.set(currentUserAtom, {
    id: "user-1",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  // Strict: the org-a tenant must see ONLY its own row — the global NULL row
  // is NOT visible (the `OR org IS NULL` escape is dropped).
  const results = await repository.findMany();
  expect(results.map((r: any) => r.name).sort()).toEqual(["org-a-row"]);
  expect(await repository.count()).toEqual(1);
};

export const testStrictFailsClosedWithoutTenant = async (alepha: Alepha) => {
  const { repository } = await setupStrict(alepha);

  await repository.create({
    name: "org-a-row",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  // No tenant/user in context: a strict entity must REFUSE to return rows,
  // not fall through to an unfiltered "see everything" query.
  await expect(repository.findMany()).rejects.toThrow(AlephaError);
  await expect(repository.count()).rejects.toThrow(AlephaError);
};

export const testStrictFailsClosedForOrglessUser = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setupStrict(alepha);

  await repository.create({
    name: "org-a-row",
    organization: "a0000000-0000-0000-0000-000000000001",
  });

  // A user with no organization resolves no tenant → still fail closed
  // (there is no "master sees everything" for a strict entity).
  app.store.set(currentUserAtom, { id: "orgless-user" });
  await expect(repository.findMany()).rejects.toThrow(AlephaError);
};

export const testStrictRefusesInsertWithoutTenant = async (alepha: Alepha) => {
  const { repository } = await setupStrict(alepha);

  // Inserting with neither an explicit org nor a resolved tenant would create
  // an unscoped NULL row; strict refuses it.
  await expect(repository.create({ name: "orphan" })).rejects.toThrow(
    AlephaError,
  );
};

export const testUpsertRefusesCrossTenant = async (alepha: Alepha) => {
  const { repository, alepha: app } = await setupUpsert(alepha);

  // org-a owns the row keyed by code "SHARED".
  app.store.set(currentUserAtom, {
    id: "user-a",
    organization: "a0000000-0000-0000-0000-000000000001",
  });
  await repository.upsert(
    { code: "SHARED", name: "owned-by-a" },
    { target: ["code"] },
  );

  // org-b upserts the SAME (tenant-agnostic) unique key. The conflict-UPDATE is
  // scoped to the caller's tenant, so it must be refused rather than silently
  // overwriting org-a's row.
  app.store.set(currentUserAtom, {
    id: "user-b",
    organization: "b0000000-0000-0000-0000-000000000002",
  });
  await expect(
    repository.upsert(
      { code: "SHARED", name: "hijacked-by-b" },
      { target: ["code"] },
    ),
  ).rejects.toThrow(AlephaError);

  // org-a's row is intact.
  app.store.set(currentUserAtom, { id: "master" });
  const rows = await repository.findMany();
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toEqual("owned-by-a");
  expect(rows[0].organization).toEqual("a0000000-0000-0000-0000-000000000001");
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
