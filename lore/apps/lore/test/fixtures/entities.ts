import { folioDirectories, folios } from "@lore/knowledge/schemas";
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
import { $repository } from "alepha/orm";

export { createTestEpic, createTestQuest } from "@lore/work/testing";
export { createTestFolio, filedEpicOf } from "@lore/knowledge/testing";

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
