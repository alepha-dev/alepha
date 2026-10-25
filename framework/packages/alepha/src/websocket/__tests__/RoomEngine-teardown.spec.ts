import { describe, expect, it } from "vitest";

import { RoomEngine } from "../providers/RoomEngine.ts";

const clock = {
  setInterval: () => ({}),
  clearInterval: () => {},
  now: () => 0,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const socket = (id: string) =>
  ({ id, data: {}, sendRaw() {}, close() {} }) as never;

class ExposedEngine extends RoomEngine<any, any, any> {
  public get isAlive(): boolean {
    return this.alive;
  }

  public get currentState(): unknown {
    return this.state;
  }
}

/**
 * Teardown is the persistence hook of a room (`onEmpty`), and it is async:
 * two sockets leaving in the same tick both saw an empty room and ran it
 * twice, and a socket joining while it was still running was admitted into
 * a room whose state was cleared a moment later.
 */
describe("RoomEngine teardown", () => {
  it("runs onEmpty once when the last two sockets leave in the same tick", async () => {
    let empties = 0;
    const engine = new ExposedEngine({
      roomId: "r",
      clock,
      options: {
        channel: {} as never,
        state: () => ({ n: 1 }),
        onEmpty: () => {
          empties++;
        },
      },
    });

    await engine.join(socket("a"));
    await engine.join(socket("b"));
    await Promise.all([engine.leave("a"), engine.leave("b")]);

    expect(empties).toBe(1);
    expect(engine.isAlive).toBe(false);
  });

  it("brings the room back up for a socket that joins during an async onEmpty", async () => {
    const statesSeenOnJoin: unknown[] = [];
    let factoryCalls = 0;
    const engine = new ExposedEngine({
      roomId: "r",
      clock,
      options: {
        channel: {} as never,
        state: () => {
          factoryCalls++;
          return { n: factoryCalls };
        },
        onJoin: (room) => {
          statesSeenOnJoin.push(room.state);
        },
        onEmpty: async () => {
          await sleep(50);
        },
      },
    });

    await engine.join(socket("a"));
    const leaving = engine.leave("a");
    await sleep(10);
    await engine.join(socket("b"));
    await leaving;

    expect(engine.size).toBe(1);
    expect(engine.isAlive).toBe(true);
    // A fresh state from a second factory call, not the one being torn down.
    expect(factoryCalls).toBe(2);
    expect(engine.currentState).toEqual({ n: 2 });
    expect(statesSeenOnJoin).toEqual([{ n: 1 }, { n: 2 }]);
  });
});
