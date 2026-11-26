import {
  HostEventService,
  HostService,
  HostUnitEvents,
  projectEvents,
} from "@lore/core/api";
import { type HostEventFrame, hosts } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { LoreShipApi } from "@lore/ship/api";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

class Rows {
  hosts = $repository(hosts);
  events = $repository(projectEvents);
}

/**
 * A host's watched units (#Q4422): the names Lore normalises and sends on the
 * welcome frame, and the project events a `unit.changed` raises. A failure
 * raises `host.unit_failed`; `active` again after it raises
 * `host.unit_recovered`; a plain restart (a deploy) raises nothing; a frame
 * Bay sends twice raises once.
 */
describe("host watched units", () => {
  let alepha: Alepha;
  let rows: Rows;
  let store: HostEventService;
  let units: HostUnitEvents;
  let entities: DeployTestEntities;
  let service: HostService;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", APP_SECRET: "host-units-spec-secret" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreShipApi);
    rows = alepha.inject(Rows);
    entities = alepha.inject(DeployTestEntities);
    store = alepha.inject(HostEventService);
    units = alepha.inject(HostUnitEvents);
    service = alepha.inject(HostService);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const host = async () => {
    const user = await entities.users.create({ email: "owner@example.com" });
    const minted = await createTestHost(
      alepha,
      { id: user.id, roles: ["user"] },
      { slug: "api-box" },
    );
    return rows.hosts.getOne({ where: { id: { eq: minted.id } } });
  };

  let n = 0;
  const changed = (from: string, to: string, at: string): HostEventFrame => ({
    type: "event",
    id: `evt-${++n}`,
    kind: "unit.changed",
    at,
    data: { unit: "api.service", from, to },
  });

  /** What the socket does with an event frame. */
  const deliver = async (
    row: Awaited<ReturnType<typeof host>>,
    frame: HostEventFrame,
  ) => {
    if (await store.record(row, frame)) await units.handle(row, frame);
  };

  const names = async () =>
    (await rows.events.findMany({ orderBy: "occurredAt" }))
      .map((event) => event.name)
      .filter((name) => name.startsWith("host.unit_"));

  it("normalises names, adds .service and refuses a flag", ({ expect }) => {
    expect(
      HostUnitEvents.normalize([" api ", "caddy.service", "api.service", ""]),
    ).toEqual(["api.service", "caddy.service"]);
    expect(() => HostUnitEvents.normalize(["--now"])).toThrow();
    expect(() =>
      HostUnitEvents.normalize(
        Array.from({ length: 21 }, (_, i) => `unit${i}`),
      ),
    ).toThrow();
  });

  it("sends the watched units on the welcome frame, and none when empty", async ({
    expect,
  }) => {
    const row = await host();
    expect(service.welcomeFrame(row, "welcome").watchUnits).toBeUndefined();
    await rows.hosts.updateById(row.id, { watchUnits: ["api.service"] });
    const watched = await rows.hosts.getOne({ where: { id: { eq: row.id } } });
    expect(service.welcomeFrame(watched, "config").watchUnits).toEqual([
      "api.service",
    ]);
  });

  it("raises a failure, then a recovery, and nothing for a plain restart", async ({
    expect,
  }) => {
    const row = await host();

    // A deploy: down and back up, never failed.
    await deliver(
      row,
      changed("active", "deactivating", "2026-11-26T08:00:00Z"),
    );
    await deliver(
      row,
      changed("deactivating", "activating", "2026-11-26T08:00:05Z"),
    );
    await deliver(row, changed("activating", "active", "2026-11-26T08:12:00Z"));
    expect(await names()).toEqual([]);

    // A crash, a restart attempt, then up again.
    const failed = changed("active", "failed", "2026-11-26T09:00:00Z");
    await deliver(row, failed);
    // Bay sends it again after a dropped connection: stored once, raised once.
    await deliver(row, failed);
    await deliver(row, changed("failed", "activating", "2026-11-26T09:01:00Z"));
    await deliver(row, changed("activating", "active", "2026-11-26T09:13:00Z"));
    expect(await names()).toEqual(["host.unit_failed", "host.unit_recovered"]);

    const [failure] = await rows.events.findMany({
      where: { name: "host.unit_failed" },
    });
    expect(failure.fields).toMatchObject({
      host: "api-box",
      unit: "api.service",
      state: "failed",
    });
  });
});
