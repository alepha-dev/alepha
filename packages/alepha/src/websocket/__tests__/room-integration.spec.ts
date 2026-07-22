import { Alepha, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, test } from "vitest";
import WebSocket from "ws";
import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((r) => ws.on("open", () => r()));
}

function collect(ws: WebSocket): any[] {
  const out: any[] = [];
  ws.on("message", (d) => out.push(JSON.parse(d.toString())));
  return out;
}

async function wsHost(alepha: Alepha): Promise<string> {
  return alepha
    .inject(NodeHttpServerProvider)
    .hostname.replace("http://", "ws://");
}

describe("$room integration (Node)", () => {
  test("runs an authoritative tick loop and broadcasts world state", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Game {
      world = $channel({
        path: "/ws/world",
        schema: {
          in: z.object({ type: z.text(), players: z.number() }),
          out: z.object({ type: z.text() }),
        },
      });

      room = $room<any, any, { tick: number; players: string[] }>({
        channel: this.world,
        tickHz: 20,
        state: () => ({ tick: 0, players: [] }),
        onJoin: (room, conn) => {
          room.state.players.push(conn.id);
        },
        onLeave: (room, conn) => {
          room.state.players = room.state.players.filter(
            (p: string) => p !== conn.id,
          );
        },
        onTick: (room) => {
          room.state.tick++;
          room.broadcast({ type: "tick", players: room.state.players.length });
        },
      });
    }

    alepha.inject(Game);
    await alepha.start();
    const host = await wsHost(alepha);

    const a = new WebSocket(`${host}/ws/world?roomId=lobby`);
    const aMsgs = collect(a);
    await waitForOpen(a);
    await delay(120);

    // The loop is running and the server counts one player.
    expect(aMsgs.length).toBeGreaterThan(0);
    expect(aMsgs.at(-1)).toMatchObject({ type: "tick", players: 1 });

    const b = new WebSocket(`${host}/ws/world?roomId=lobby`);
    const bMsgs = collect(b);
    await waitForOpen(b);
    await delay(120);

    // Both clients now see two players in the same room.
    expect(bMsgs.at(-1)).toMatchObject({ players: 2 });

    a.close();
    await delay(120);

    // After A leaves, the loop keeps running and the count drops to one.
    expect(bMsgs.at(-1)).toMatchObject({ players: 1 });

    b.close();
    await delay(60);
    await alepha.stop();
  });

  test("delivers a per-recipient reply only to the sender", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Echo {
      ch = $channel({
        path: "/ws/echo",
        schema: {
          in: z.object({ echo: z.text() }),
          out: z.object({ ping: z.text() }),
        },
      });

      room = $room({
        channel: this.ch,
        onMessage: (room, conn, message: { ping: string }) => {
          room.send(conn.id, { echo: message.ping });
        },
      });
    }

    alepha.inject(Echo);
    await alepha.start();
    const host = await wsHost(alepha);

    const a = new WebSocket(`${host}/ws/echo?roomId=r`);
    const aMsgs = collect(a);
    const b = new WebSocket(`${host}/ws/echo?roomId=r`);
    const bMsgs = collect(b);
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    a.send(JSON.stringify({ ping: "hello" }));
    await delay(80);

    expect(aMsgs).toEqual([{ echo: "hello" }]);
    expect(bMsgs).toEqual([]);

    a.close();
    b.close();
    await delay(40);
    await alepha.stop();
  });

  test("headless coordinator room answers method calls over party state", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);

    class Coordinator {
      party = $channel({
        path: "/ws/party",
        schema: {
          in: z.object({ x: z.number() }),
          out: z.object({ x: z.number() }),
        },
      });

      session = $room<any, any, { switches: Record<string, boolean> }>({
        channel: this.party,
        state: () => ({ switches: {} }),
        methods: {
          setSwitch: (room, id: string, value: boolean) => {
            room.state.switches[id] = value;
            return true;
          },
          getSwitch: (room, id: string) => room.state.switches[id] ?? false,
        },
      });
    }

    const coordinator = alepha.inject(Coordinator);
    await alepha.start();

    await coordinator.session.call("party-1", "setSwitch", "door", true);
    const open = await coordinator.session.call("party-1", "getSwitch", "door");
    const other = await coordinator.session.call(
      "party-2",
      "getSwitch",
      "door",
    );

    expect(open).toBe(true);
    expect(other).toBe(false); // isolated per room id

    await alepha.stop();
  });
});
