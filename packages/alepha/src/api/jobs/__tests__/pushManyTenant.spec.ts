import { Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { $job, AlephaApiJobs, jobExecutionEntity } from "../index.ts";

const ORG = "33333333-3333-4333-8333-333333333333";

/**
 * `pushMany` has two paths and they are easy to get differently wrong: keyed
 * items are re-pushed one at a time through `push()`, everything else goes
 * through one bulk insert. A field added to `PushManyItem` and to the bulk
 * builder still vanishes on the keyed path unless the forwarding call carries
 * it too, and nothing about a passing bulk test would say so.
 */
class App {
  readonly work = $job({
    // Without this the rows are trimmed as soon as they succeed and there is
    // nothing left to assert the tenant on.
    record: "all",
    keep: { ok: 0, error: 0 },
    schema: z.object({ n: z.integer() }),
    handler: async () => {},
  });

  readonly executions = $repository(jobExecutionEntity);
}

const boot = async () => {
  const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);
  const app = alepha.inject(App);
  await alepha.start();
  return { alepha, app };
};

const rowsFor = async (app: App) =>
  await app.executions.findMany({
    where: { jobName: { eq: "App.work" } },
  });

describe("pushMany carries the owning tenant", () => {
  it("stamps organizationId on the bulk path", async ({ expect }) => {
    const { app } = await boot();

    await app.work.pushMany([
      { payload: { n: 1 }, organizationId: ORG },
      { payload: { n: 2 }, organizationId: ORG },
    ]);

    const rows = await rowsFor(app);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.organizationId === ORG)).toBe(true);
  });

  it("stamps organizationId on the keyed path too", async ({ expect }) => {
    const { app } = await boot();

    await app.work.pushMany([
      { payload: { n: 1 }, organizationId: ORG, key: "one" },
      { payload: { n: 2 }, organizationId: ORG, key: "two" },
    ]);

    const rows = await rowsFor(app);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.organizationId === ORG)).toBe(true);
  });

  it("keeps each item's own tenant in a mixed batch", async ({ expect }) => {
    const { app } = await boot();
    const other = "44444444-4444-4444-8444-444444444444";

    await app.work.pushMany([
      { payload: { n: 1 }, organizationId: ORG },
      { payload: { n: 2 }, organizationId: other, key: "keyed" },
    ]);

    const rows = await rowsFor(app);
    const byPayload = new Map(
      rows.map((row) => [(row.payload as { n: number }).n, row.organizationId]),
    );
    expect(byPayload.get(1)).toBe(ORG);
    expect(byPayload.get(2)).toBe(other);
  });

  it("leaves the column null when no tenant was given", async ({ expect }) => {
    const { app } = await boot();

    await app.work.pushMany([{ payload: { n: 1 } }]);

    const rows = await rowsFor(app);
    expect(rows[0].organizationId ?? null).toBeNull();
  });
});
