import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { HttpError } from "alepha/server";
import { describe, expect, it } from "vitest";

import { LoreDeployer } from "../services/LoreDeployer.ts";

/**
 * `LoreDeployer.start` asks Lore to start a run. `startDeploy` does not
 * dedupe, and a connection reset can land after Lore queued the run, so a
 * retry first looks for a run of the tag started since the first attempt and
 * follows it. Lore's own answer is never retried. Seen in CI (#Q3903).
 */
describe("LoreDeployer.start", () => {
  const create = (input: {
    start: Array<
      (queued: Array<Record<string, unknown>>, now: string) => unknown
    >;
    before?: Array<Record<string, unknown>>;
  }) => {
    const alepha = Alepha.create({
      env: { LORE_API_KEY: "k", LORE_URL: "", LORE_PROJECT: "" },
    });
    const deployer = alepha.inject(LoreDeployer);
    const dateTime = alepha.inject(DateTimeProvider);
    const queued: Array<Record<string, unknown>> = [...(input.before ?? [])];
    let starts = 0;
    let lists = 0;
    Object.assign(deployer as unknown as object, {
      deploys: {
        startDeploy: async () => {
          const answer = input.start[Math.min(starts, input.start.length - 1)];
          starts += 1;
          return answer(queued, new Date(dateTime.nowMillis()).toISOString());
        },
        listDeployments: async () => {
          lists += 1;
          return { items: queued.toReversed() };
        },
      },
    });
    // No real wait between attempts.
    Object.assign(dateTime as unknown as object, { wait: async () => {} });
    return {
      deployer,
      starts: () => starts,
      lists: () => lists,
    };
  };

  const reset = () => {
    throw Object.assign(new TypeError("read ECONNRESET"), {
      code: "ECONNRESET",
    });
  };

  it("starts again after a reset before Lore saw the POST, and starts once", async () => {
    const queue = (queued: Array<Record<string, unknown>>, now: string) => {
      const row = {
        id: `dep-${queued.length + 1}`,
        tag: "abc",
        status: "queued",
        createdAt: now,
      };
      queued.push(row);
      return { id: row.id, status: row.status };
    };
    const { deployer, starts, lists } = create({ start: [reset, queue] });

    await expect(deployer.start(1, "inst", "abc")).resolves.toEqual({
      id: "dep-1",
      status: "queued",
    });
    expect(starts()).toBe(2);
    expect(lists()).toBe(1);
  });

  it("follows the run Lore queued when only the answer was lost", async () => {
    const queuedThenReset = (
      queued: Array<Record<string, unknown>>,
      now: string,
    ) => {
      queued.push({
        id: "dep-new",
        tag: "abc",
        status: "running",
        createdAt: now,
      });
      reset();
    };
    const { deployer, starts } = create({
      start: [queuedThenReset],
      before: [
        {
          id: "dep-old",
          tag: "abc",
          status: "succeeded",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });

    await expect(deployer.start(1, "inst", "abc")).resolves.toEqual({
      id: "dep-new",
      status: "running",
    });
    expect(starts()).toBe(1);
  });

  it("ignores an older run of the same tag", async () => {
    const { deployer, starts } = create({
      start: [reset],
      before: [
        {
          id: "dep-old",
          tag: "abc",
          status: "succeeded",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });

    await expect(deployer.start(1, "inst", "abc")).rejects.toThrow(
      "the connection to Lore was reset 3 times (read ECONNRESET)",
    );
    expect(starts()).toBe(3);
  });

  it("never retries Lore's own answer", async () => {
    const { deployer, starts, lists } = create({
      start: [
        () => {
          throw new HttpError(
            { status: 409 },
            { message: "A deploy of this copy is already running" },
          );
        },
      ],
    });

    await expect(deployer.start(1, "inst", "abc")).rejects.toThrow(
      "A deploy of this copy is already running",
    );
    expect(starts()).toBe(1);
    expect(lists()).toBe(0);
  });

  it("never retries a 5xx either", async () => {
    const { deployer, starts } = create({
      start: [
        () => {
          throw new HttpError({ status: 502 }, { message: "Bad gateway" });
        },
      ],
    });

    await expect(deployer.start(1, "inst", "abc")).rejects.toThrow(
      "Bad gateway",
    );
    expect(starts()).toBe(1);
  });
});
