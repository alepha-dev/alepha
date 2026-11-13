import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { HttpError } from "alepha/server";
import { describe, expect, it } from "vitest";

import { LoreDeployer } from "../services/LoreDeployer.ts";

/**
 * `LoreDeployer.follow` polls a deploy that runs on Lore. A dropped connection
 * while asking says nothing about the deploy, so it is asked again; Lore's own
 * refusal is not. Seen in CI: a reset from the edge (`read ECONNRESET`) failed
 * a deploy that went on to succeed.
 */
describe("LoreDeployer.follow", () => {
  const create = (answers: Array<() => unknown>) => {
    const alepha = Alepha.create({
      env: { LORE_API_KEY: "k", LORE_URL: "", LORE_PROJECT: "" },
    });
    const deployer = alepha.inject(LoreDeployer);
    let calls = 0;
    Object.assign(deployer as unknown as object, {
      deploys: {
        getDeployment: async () => {
          const answer = answers[Math.min(calls, answers.length - 1)];
          calls += 1;
          return answer();
        },
      },
    });
    // No real wait between polls.
    Object.assign(alepha.inject(DateTimeProvider) as unknown as object, {
      wait: async () => {},
    });
    return { deployer, calls: () => calls };
  };

  const reset = () => {
    throw Object.assign(new TypeError("read ECONNRESET"), {
      code: "ECONNRESET",
    });
  };
  const succeeded = () => ({ status: "succeeded", url: "https://x", log: [] });

  it("asks again after a dropped connection, and reports the deploy", async () => {
    const { deployer, calls } = create([
      () => ({ status: "running", log: [] }),
      reset,
      reset,
      succeeded,
    ]);

    await expect(deployer.follow(1, "dep-1")).resolves.toEqual({
      status: "succeeded",
      error: undefined,
      url: "https://x",
    });
    expect(calls()).toBe(4);
  });

  it("treats a 5xx from the edge like a dropped connection", async () => {
    const { deployer, calls } = create([
      () => {
        throw new HttpError({ status: 502 }, { message: "Bad gateway" });
      },
      succeeded,
    ]);

    await expect(deployer.follow(1, "dep-1")).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(calls()).toBe(2);
  });

  it("gives up after too many failed polls in a row", async () => {
    const { deployer, calls } = create([reset]);

    await expect(deployer.follow(1, "dep-1")).rejects.toThrow(
      "read ECONNRESET",
    );
    expect(calls()).toBe(6);
  });

  it("never retries Lore's own refusal", async () => {
    const { deployer, calls } = create([
      () => {
        throw new HttpError({ status: 404 }, { message: "Deploy not found" });
      },
      succeeded,
    ]);

    await expect(deployer.follow(1, "dep-1")).rejects.toThrow(
      "Deploy not found",
    );
    expect(calls()).toBe(1);
  });
});
