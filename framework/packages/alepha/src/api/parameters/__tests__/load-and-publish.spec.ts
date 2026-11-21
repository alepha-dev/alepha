import { $hook, Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $role, AlephaSecurity, type UserAccountToken } from "alepha/security";
import { describe, it } from "vitest";

import {
  $parameter,
  AdminParameterController,
  AlephaApiParameters,
  ParameterProvider,
  parameters,
} from "../index.ts";

/**
 * A provider whose database read can be held open, whose publishes are
 * recorded and can be made to fail, and whose caches can be dropped, which
 * is the state of an instance that has not loaded yet.
 */
class GatedParameterProvider extends ParameterProvider {
  public gate?: Promise<void>;
  public reads = 0;
  public settledReads = 0;
  public readonly published: string[] = [];
  public failPublish = false;

  public override async loadCurrentAndNext(
    name: string,
  ): ReturnType<ParameterProvider["loadCurrentAndNext"]> {
    this.reads++;
    const gate = this.gate;
    const result = await super.loadCurrentAndNext(name);
    // Held AFTER the query: the load has read, and has not settled.
    if (gate) await gate;
    this.settledReads++;
    return result;
  }

  protected override async publishChange(name: string): Promise<void> {
    if (this.failPublish) throw new AlephaError("topic down");
    this.published.push(name);
    await super.publishChange(name);
  }

  public forget(name: string): void {
    this.evictCaches(name);
  }

  /**
   * Leaves the instance as one that loaded before a scheduled version was
   * written: it holds no next.
   */
  public dropNext(name: string): void {
    this.cachedNext.delete(name);
  }

  /**
   * A sync message from another instance.
   */
  public receive(name: string): Promise<void> {
    return this.handleChangeNotification({
      name,
      instanceId: "another-instance",
    });
  }

  public isCached(name: string): boolean {
    return this.cachedCurrent.has(name);
  }
}

const schema = z.object({ name: z.text(), age: z.integer() });

class Settings {
  p = $parameter({
    name: "edges.p",
    schema,
    default: { name: "default", age: 1 },
  });
  q = $parameter({
    name: "edges.q",
    schema,
    default: { name: "default", age: 1 },
  });
}

/**
 * Runs `run` once, inside the next insert into `parameters`, after the row
 * is written and before the save that wrote it goes on: the one place
 * another instance's write can land in the middle of a `save()`.
 */
class DuringNextInsert {
  public readonly rows = $repository(parameters);
  public run?: (row: { activationDate: string }) => Promise<void>;

  protected readonly onInsert = $hook({
    on: "repository:create:after",
    handler: async ({ tableName, entity }) => {
      if (tableName !== "parameters" || !this.run) return;
      const run = this.run;
      this.run = undefined;
      await run(entity as { activationDate: string });
    },
  });
}

class Roles {
  reader = $role({
    name: "parameter-reader",
    permissions: [{ name: "admin:parameter:read" }],
  });
}

const reader: UserAccountToken = {
  id: "00000000-0000-4000-8000-00000000abcd",
  realm: "default",
  roles: ["parameter-reader"],
};

const setup = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  })
    .with({ provide: ParameterProvider, use: GatedParameterProvider })
    .with(AlephaSecurity)
    .with(AlephaApiParameters)
    .with(Settings);
  alepha.inject(Roles);
  const during = alepha.inject(DuringNextInsert);
  const controller = alepha.inject(AdminParameterController);
  await alepha.start();
  return {
    alepha,
    controller,
    during,
    settings: alepha.inject(Settings),
    provider: alepha.inject(ParameterProvider) as GatedParameterProvider,
    time: alepha.inject(DateTimeProvider),
  };
};

/**
 * Yields to the event loop until `done`. Bounded in turns, not in time.
 */
const settled = async (done: () => boolean) => {
  for (let turn = 0; turn < 1000 && !done(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe("ParameterProvider: loads, saves and publishes that cross", () => {
  it("keeps a saved value when a load that read before it settles after it", async ({
    expect,
  }) => {
    const { settings, provider } = await setup();
    await settings.p.set({ name: "v1", age: 1 });

    // A load reads the database (what a sync notification starts), and is
    // held before it writes the caches.
    let open = () => {};
    provider.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const loading = provider.load("edges.p");
    await settled(() => provider.reads > provider.settledReads);
    provider.gate = undefined;

    await settings.p.set({ name: "v2", age: 2 });
    open();
    await loading;

    expect(await settings.p.get()).toEqual({ name: "v2", age: 2 });
  });

  it("ends on the database's value when the load a save discards had read a newer write", async ({
    expect,
  }) => {
    const { settings, provider, during } = await setup();
    await settings.p.set({ name: "v1", age: 1 });

    // In the middle of the save of v2, another instance writes v3 and its
    // sync message starts a load here, which reads v3 and is still in flight
    // when the save writes the cache.
    let open = () => {};
    let loading: Promise<void> | undefined;
    during.run = async (v2) => {
      await during.rows.create({
        name: "edges.p",
        content: { name: "v3", age: 3 },
        schemaHash: "",
        activationDate: v2.activationDate,
        version: 3,
      });
      provider.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      loading = provider.load("edges.p");
      provider.gate = undefined;
    };
    await settings.p.set({ name: "v2", age: 2 });
    open();
    await loading;

    const [latest] = await provider.getHistory("edges.p", { limit: 1 });
    expect(latest.content).toEqual({ name: "v3", age: 3 });
    expect(await settings.p.get()).toEqual({ name: "v3", age: 3 });
  });

  it("answers a cold get() from the newer load that superseded its own", async ({
    expect,
  }) => {
    const { settings, provider } = await setup();
    await settings.p.set({ name: "stored", age: 7 });
    provider.forget("edges.p");

    // get() starts a load; load() starts a second one, which supersedes the
    // first and is held open.
    const before = provider.settledReads;
    const first = settings.p.get();
    let open = () => {};
    provider.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const second = provider.load("edges.p");
    provider.gate = undefined;
    // The first load has settled, superseded, with nothing in the cache.
    await settled(() => provider.settledReads > before);
    expect(provider.isCached("edges.p")).toBe(false);

    open();
    await second;

    expect(await first).toEqual({ name: "stored", age: 7 });
  });

  it("publishes a scheduled save, so other instances hold it as their next", async ({
    expect,
  }) => {
    const { settings, provider, time } = await setup();
    await settings.p.set({ name: "now", age: 1 });
    provider.published.length = 0;

    await settings.p.set(
      { name: "later", age: 2 },
      { activationDate: time.now().add(1, "hour").toDate() },
    );

    expect(provider.published).toEqual(["edges.p"]);

    // The second instance, played here: it loaded before the scheduled
    // version existed, so it holds no next, and it receives what the first
    // one published.
    provider.dropNext("edges.p");
    for (const name of provider.published) {
      await provider.receive(name);
    }

    await time.travel(30, "minutes");
    expect(await settings.p.get()).toEqual({ name: "now", age: 1 });
    await time.travel(31, "minutes");
    expect(await settings.p.get()).toEqual({ name: "later", age: 2 });
  });

  it("keeps a scheduled save whose publish fails: one version, no error", async ({
    expect,
  }) => {
    const { settings, provider, time } = await setup();
    await settings.p.set({ name: "now", age: 1 });

    provider.failPublish = true;
    await expect(
      settings.p.set(
        { name: "later", age: 2 },
        { activationDate: time.now().add(1, "hour").toDate() },
      ),
    ).resolves.toBeUndefined();
    provider.failPublish = false;

    const history = await provider.getHistory("edges.p");
    expect(history.map((version) => version.version)).toEqual([2, 1]);
    // This instance still switches at the date.
    await time.travel(61, "minutes");
    expect(await settings.p.get()).toEqual({ name: "later", age: 2 });
  });

  it("still rejects an immediate save whose publish fails", async ({
    expect,
  }) => {
    const { settings, provider } = await setup();
    provider.failPublish = true;

    await expect(settings.p.set({ name: "now", age: 1 })).rejects.toThrow(
      "topic down",
    );
  });

  it("evicts every deleted name even when a publish fails", async ({
    expect,
  }) => {
    const { settings, provider } = await setup();
    await settings.p.set({ name: "a", age: 1 });
    await settings.q.set({ name: "b", age: 2 });

    provider.failPublish = true;
    await expect(provider.deleteMany(["edges.p", "edges.q"])).rejects.toThrow(
      "topic down",
    );
    provider.failPublish = false;

    expect(provider.isCached("edges.p")).toBe(false);
    expect(provider.isCached("edges.q")).toBe(false);
    expect(await settings.q.get()).toEqual({ name: "default", age: 1 });
  });

  it("records as previousContent the current version's content, not the highest version's", async ({
    expect,
  }) => {
    const { settings, provider, time } = await setup();
    await settings.p.set({ name: "one", age: 1 });
    await settings.p.set({ name: "two", age: 2 });
    // Back-dated: version 3 is the highest number and was never current.
    await settings.p.set(
      { name: "three", age: 3 },
      { activationDate: time.now().subtract(1, "day").toDate() },
    );
    expect(await settings.p.get()).toEqual({ name: "two", age: 2 });

    const saved = await provider.save("edges.p", { name: "four", age: 4 }, "");

    expect(saved.previousContent).toEqual({ name: "two", age: 2 });
  });

  it("forwards activationDate and tags through the primitive's rollback()", async ({
    expect,
  }) => {
    const { settings, time } = await setup();
    await settings.p.set({ name: "one", age: 1 });
    await settings.p.set({ name: "two", age: 2 });
    const nextWeek = time.now().add(7, "day").toDate();

    await settings.p.rollback(1, { activationDate: nextWeek, tags: ["undo"] });

    // Scheduled, so the current value has not moved.
    expect(await settings.p.get()).toEqual({ name: "two", age: 2 });
    const [latest] = await settings.p.getHistory({ limit: 1 });
    expect(latest.content).toEqual({ name: "one", age: 1 });
    expect(latest.activationDate).toBe(nextWeek.toISOString());
    expect(latest.tags).toEqual(["undo"]);
  });
});

describe("AdminParameterController: statuses among all versions", () => {
  it("reports one version, and one page of the history, against the real current", async ({
    expect,
  }) => {
    const { controller, settings, time } = await setup();
    const as = { user: reader };
    time.pause();
    for (const age of [1, 2, 3, 4]) {
      await settings.p.set({ name: "v", age });
      await time.travel(1, "minute");
    }
    await settings.p.set(
      { name: "v", age: 5 },
      { activationDate: time.now().add(1, "hour").toDate() },
    );

    const one = await controller.getVersion.run(
      { params: { name: "edges.p", version: 1 } },
      as,
    );
    expect(one.parameter?.status).toBe("expired");
    const four = await controller.getVersion.run(
      { params: { name: "edges.p", version: 4 } },
      as,
    );
    expect(four.parameter?.status).toBe("current");
    const five = await controller.getVersion.run(
      { params: { name: "edges.p", version: 5 } },
      as,
    );
    expect(five.parameter?.status).toBe("next");

    // Versions 2 and 1: a page that does not hold the current one.
    const page = await controller.getHistory.run(
      { params: { name: "edges.p" }, query: { limit: 2, offset: 3 } },
      as,
    );
    expect(
      page.versions.map((version) => [version.version, version.status]),
    ).toEqual([
      [1, "expired"],
      [2, "expired"],
    ]);
  });
});
