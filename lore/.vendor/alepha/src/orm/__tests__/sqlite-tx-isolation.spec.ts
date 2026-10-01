import { Alepha, z } from "alepha";
import { $entity, $repository, DatabaseProvider, db } from "alepha/orm";
import { describe, it } from "vitest";

const notes = $entity({
  name: "tx_isolation_notes",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
  }),
});

class Notes {
  repo = $repository(notes);
}

/**
 * #Q2516: node:sqlite shares one connection, and a transaction on it is
 * connection-scoped. Only BEGIN blocks were serialized, so a plain statement
 * from another request, run while transaction A awaited, ran INSIDE A: it
 * read A's uncommitted rows, and A's rollback took its acknowledged write
 * with it.
 */
describe("sync SQLite: a transaction does not absorb other requests' statements", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    const app = alepha.inject(Notes);
    await alepha.start();
    return {
      alepha,
      repo: app.repo,
      provider: alepha.inject(DatabaseProvider),
    };
  };

  it("keeps a write made during a rolled-back transaction, and hides the transaction's rows from it", async ({
    expect,
  }) => {
    const { alepha, repo, provider } = await setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let began!: () => void;
    const begun = new Promise<void>((resolve) => {
      began = resolve;
    });

    // Request A: writes, then waits, then fails.
    const a = alepha.context
      .run(() =>
        provider.transactional(async () => {
          await repo.create({ name: "from-a" });
          began();
          await held;
          throw new Error("A rolls back");
        }),
      )
      .catch(() => "rolled back");

    await begun;
    // Request B, in its own context, while A is open.
    const bRead = alepha.context.run(() => repo.findMany());
    const bWrite = alepha.context.run(() => repo.create({ name: "from-b" }));
    // Long enough for B's statements to reach the connection while A is
    // still open, which is where they used to run.
    await new Promise((resolve) => setTimeout(resolve, 30));

    release();
    expect(await a).toBe("rolled back");
    await bWrite;

    // B never saw A's uncommitted row...
    expect((await bRead).map((row) => row.name)).toEqual([]);
    // ...and A's rollback did not take B's write with it.
    expect((await repo.findMany()).map((row) => row.name)).toEqual(["from-b"]);
  });

  it("does not let a concurrent transaction join another one with no BEGIN of its own", async ({
    expect,
  }) => {
    const { repo, provider } = await setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let began!: () => void;
    const begun = new Promise<void>((resolve) => {
      began = resolve;
    });

    // Both called from the same context: the marker used to be written into
    // it, so a transactional() started while the first was open saw it and
    // joined, running inside the first with no BEGIN of its own.
    const first = provider
      .transactional(async () => {
        await repo.create({ name: "first" });
        began();
        await held;
        throw new Error("first rolls back");
      })
      .catch(() => undefined);
    await begun;
    const second = provider.transactional(async () => {
      await repo.create({ name: "second" });
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    release();
    await first;
    await second;

    expect((await repo.findMany()).map((row) => row.name)).toEqual(["second"]);
  });
});
