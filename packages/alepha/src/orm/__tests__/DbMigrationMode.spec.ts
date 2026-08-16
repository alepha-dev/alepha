import { Alepha, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { describe, it } from "vitest";
import { AlephaOrm } from "../core/index.ts";

const noteEntity = $entity({
  name: "migration_mode_notes",
  schema: z.object({
    id: db.primaryKey(),
    title: z.text(),
  }),
});

/**
 * `MIGRATE=true node app.js` — the documented deploy-time migration step, and
 * what `alepha db migrations apply` boots underneath.
 *
 * It threw `CircularDependencyError` on every app mounting the ORM, because
 * `DbMigrationMode` belongs to `AlephaOrm` *and* injects `DatabaseProvider`
 * from the same module. Rebuilding the pruned graph re-registered the module
 * around the half-built target. The mechanism is covered generically in
 * `core/__tests__/$mode.spec.ts`; this pins the real path that reported it.
 */
describe("DbMigrationMode", () => {
  it("should boot and run migrations under MIGRATE=true", async () => {
    const alepha = Alepha.create({
      env: { MIGRATE: "true", DATABASE_URL: "sqlite://:memory:" },
    }).with(AlephaOrm);

    // Declares a schema, so the migrate path has something to do.
    alepha.with(
      class NoteRepository {
        notes = noteEntity;
      },
    );

    await alepha.start();
  });
});
