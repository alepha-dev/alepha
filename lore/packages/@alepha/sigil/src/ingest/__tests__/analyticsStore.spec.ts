import { Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { createOrmAnalyticsStore } from "../createOrmAnalyticsStore.ts";
import { createSigilAnalyticsEntities } from "../createSigilAnalyticsEntities.ts";
import { MemoryAnalyticsStore } from "../MemoryAnalyticsStore.ts";
import { analyticsStoreConformanceTests } from "./analyticsStoreConformance.ts";

/**
 * Stand-in for the consuming app's `sigils` table.
 *
 * The whole reason `createSigilAnalyticsEntities` takes a thunk is that the
 * referenced table belongs to the app, not to this package — so the test has
 * to bring its own, and by doing so exercises the parameterisation rather than
 * asserting around it. It only needs the column the foreign key points at.
 */
const sigils = $entity({
  name: "sigils",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
  }),
});

const analytics = createSigilAnalyticsEntities({
  sigilIdRef: () => sigils.cols.id,
});

class TestOrmAnalyticsStore extends createOrmAnalyticsStore(analytics) {}

/** Only exists so the conformance rows have a parent to reference. */
class TestSigils {
  repository = $repository(sigils);
}

analyticsStoreConformanceTests("memory", () => new MemoryAnalyticsStore());

analyticsStoreConformanceTests("orm (sqlite)", async () => {
  const alepha = Alepha.create({ env: { DATABASE_URL: ":memory:" } });
  const parents = alepha.inject(TestSigils);
  const store = alepha.inject(TestOrmAnalyticsStore);
  await alepha.start();

  // The conformance cases absorb rows for two fixed sigil ids. The foreign key
  // is real — that is the point of parameterising it rather than dropping it —
  // so the parents have to exist before anything references them.
  await parents.repository.create({
    id: "11111111-1111-4111-8111-111111111111",
  });
  await parents.repository.create({
    id: "22222222-2222-4222-8222-222222222222",
  });

  return store;
});
