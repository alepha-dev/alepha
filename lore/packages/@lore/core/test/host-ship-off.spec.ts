import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import WebSocket from "ws";

import { HostCommandController } from "../src/api/controllers/HostCommandController.ts";
import { HostController } from "../src/api/controllers/HostController.ts";
import { HostSocketController } from "../src/api/controllers/HostSocketController.ts";
import { ProjectHostController } from "../src/api/controllers/ProjectHostController.ts";
import { hostProjects } from "../src/api/entities/hostProjects.ts";
import { hosts } from "../src/api/entities/hosts.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { BayReleaseTarget } from "../src/api/services/BayReleaseTarget.ts";
import { HostCommandTransport } from "../src/api/services/HostCommandTransport.ts";
import { HostInventoryService } from "../src/api/services/HostInventoryService.ts";
import { WebSocketHostCommandTransport } from "../src/api/services/WebSocketHostCommandTransport.ts";
import {
  CoreTestEntities,
  createTestProject,
} from "../src/testing/entities.ts";
import { createTestHost } from "../src/testing/hosts.ts";

/**
 * The release this Lore offers, pinned: nothing built a spec.
 */
class FixedReleaseTarget extends BayReleaseTarget {
  override version(): string | undefined {
    return "0.40.0";
  }
}

class Rows {
  hosts = $repository(hosts);
  loans = $repository(hostProjects);
}

interface Client {
  ws: WebSocket;
  frames: Array<Record<string, unknown>>;
}

/**
 * A host with no Ship anywhere (#E166, #Q4117): only `LoreCoreApi` is
 * booted, and every project has Plan and Build. The host is created,
 * enrolled, connects over the real websocket, is lent, upgraded and
 * refreshed, through the same endpoints a Ship project uses.
 */
describe("a host with Ship off", () => {
  let alepha: Alepha;
  let rows: Rows;
  let url: string;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with({
      provide: HostCommandTransport,
      use: WebSocketHostCommandTransport,
    });
    alepha.with({ provide: BayReleaseTarget, use: FixedReleaseTarget });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreCoreApi);
    alepha.inject(CoreTestEntities);
    rows = alepha.inject(Rows);
    await alepha.start();
    url =
      alepha
        .inject(NodeHttpServerProvider)
        .hostname.replace("http://", "ws://") + HostSocketController.PATH;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const waitFor = async (predicate: () => boolean, what: string) => {
    const deadline = performance.now() + 2_000;
    while (!predicate()) {
      if (performance.now() > deadline) {
        throw new Error(`Timed out waiting for ${what}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  const connect = (secret: string): Promise<Client> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { authorization: `Bearer ${secret}` },
      });
      const client: Client = { ws, frames: [] };
      ws.on("message", (data: Buffer) => {
        client.frames.push(JSON.parse(data.toString("utf8")));
      });
      ws.on("open", () => resolve(client));
      ws.on("unexpected-response", (_req, res) =>
        reject(new Error(`refused ${res.statusCode}`)),
      );
      ws.on("error", reject);
    });

  it("enrols, connects, lends, upgrades and refreshes", async ({ expect }) => {
    const user = await CoreTestEntities.of(alepha).users.create({});
    const owner: UserAccountToken = { id: user.id, roles: ["user"] };
    const noShip = [{ key: "plan" as const }, { key: "remember" as const }];
    const home = await createTestProject(alepha, {
      createdBy: owner.id,
      capabilities: noShip,
    });
    const borrower = await createTestProject(alepha, {
      createdBy: owner.id,
      capabilities: noShip,
    });
    const minted = await createTestHost(
      alepha,
      owner,
      { slug: "vps-1" },
      { projectId: home.id },
    );
    const hostApi = alepha.inject(HostController);
    const params = { hostId: minted.id };

    // Enrol: the one-time secret, exchanged for the one the socket takes.
    const enrolment = await hostApi.createHostEnrolment(
      { params },
      { user: owner },
    );
    const answer = await fetch(
      url
        .replace("ws://", "http://")
        .replace(HostSocketController.PATH, "/estates/enrol"),
      {
        method: "POST",
        headers: { authorization: `Bearer ${enrolment.secret}` },
      },
    );
    expect(answer.status).toBe(200);
    const { secret } = (await answer.json()) as { secret: string };

    // Connect.
    const client = await connect(secret);
    client.ws.send(JSON.stringify({ type: "hello" }));
    await waitFor(
      () => client.frames.some((frame) => frame.type === "welcome"),
      "the welcome frame",
    );

    // Lend it to another project without Ship.
    await alepha
      .inject(ProjectHostController)
      .attachHost(
        { params: { projectId: borrower.id }, body: { hostId: minted.id } },
        { user: owner },
      );
    expect(
      await rows.loans.count({
        hostId: { eq: minted.id },
        projectId: { eq: borrower.id },
      }),
    ).toBe(1);

    // Upgrade: Bay reports its version, the owner asks for the release.
    await hostApi.updateHost(
      { params, body: { deployAllowed: true } },
      { user: owner },
    );
    const host = await rows.hosts.getById(minted.id);
    await alepha.inject(HostInventoryService).record(host, {
      type: "inventory",
      at: alepha.inject(DateTimeProvider).nowISOString(),
      host: { bayVersion: "0.39.0", upgradeMode: "handoff" },
      apps: [],
    });
    const upgrade = await alepha
      .inject(HostCommandController)
      .enqueueHostCommand(
        { params, body: { kind: "upgrade" } },
        { user: owner },
      );
    expect(upgrade.kind).toBe("upgrade");
    await waitFor(
      () =>
        client.frames.some(
          (frame) => frame.type === "command" && frame.kind === "upgrade",
        ),
      "the upgrade command",
    );

    // Refresh: the machine is asked for fresh numbers.
    const refreshed = await hostApi.refreshHost({ params }, { user: owner });
    expect(refreshed.asked).toBe(true);
    await waitFor(
      () => client.frames.some((frame) => frame.type === "query"),
      "the query frame",
    );

    client.ws.close();
  });
});
