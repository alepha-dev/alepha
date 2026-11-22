import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { SIGIL_FEEDBACK_TRAIL_LIMITS } from "../../shared/sigilFeedbackTrail.ts";
import { SigilBrowserProvider } from "../SigilBrowserProvider.ts";
import { SigilTrail } from "../SigilTrail.ts";

/**
 * The feedback trail (#Q4038): capped ring buffers, filled through the same
 * crash filter as the error queue, whatever the sink's switches say.
 */
describe("SigilTrail", () => {
  it("keeps the last 5 crashes, 5 paths and 5 actions", () => {
    let now = 0;
    const trail = new SigilTrail(() => now);
    for (let i = 0; i < 8; i++) trail.addError(`boom ${i}`, "/");
    for (let i = 0; i < 14; i++) trail.addPage(`/p${i}`);
    for (let i = 0; i < 25; i++) {
      trail.beginAction(`a${i}`);
      now += 7;
      trail.endAction(`a${i}`, i % 2 ? "error" : "success");
    }

    const snapshot = trail.snapshot();
    expect(snapshot.errors).toHaveLength(SIGIL_FEEDBACK_TRAIL_LIMITS.errors);
    expect(snapshot.errors.at(-1)?.message).toBe("boom 7");
    expect(snapshot.pages).toHaveLength(SIGIL_FEEDBACK_TRAIL_LIMITS.pages);
    expect(snapshot.pages.at(-1)?.path).toBe("/p13");
    expect(snapshot.actions).toHaveLength(SIGIL_FEEDBACK_TRAIL_LIMITS.actions);
    expect(snapshot.actions.at(-1)).toEqual({
      name: "a24",
      outcome: "success",
      ms: 7,
    });
  });

  it("carries a name, an outcome and a duration, never arguments", () => {
    const trail = new SigilTrail(() => 0);
    trail.endAction("save", "error");
    expect(Object.keys(trail.snapshot().actions[0]!).sort()).toEqual([
      "ms",
      "name",
      "outcome",
    ]);
  });

  it("does not repeat the page it is already on", () => {
    const trail = new SigilTrail(() => 0);
    trail.addPage("/a");
    trail.addPage("/a");
    trail.addPage("/b");
    expect(trail.snapshot().pages.map((it) => it.path)).toEqual(["/a", "/b"]);
  });

  it("takes crashes only, through the error queue's filter, with every tracker off", async () => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", APP_SECRET: "test", SERVER_PORT: 0 },
    });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();

    await (alepha.events as any).emit("react:action:error", {
      type: "custom",
      id: "login",
      error: Object.assign(new Error("Invalid credentials"), { status: 401 }),
    });
    await (alepha.events as any).emit("react:action:error", {
      type: "custom",
      id: "save",
      error: Object.assign(new Error("Database down"), { status: 503 }),
    });

    const trail = provider.trail.snapshot();
    expect(trail.errors.map((it) => it.message)).toEqual(["Database down"]);
    // Both failures are actions, the refusal included.
    expect(trail.actions.map((it) => [it.name, it.outcome])).toEqual([
      ["login", "error"],
      ["save", "error"],
    ]);
    await alepha.stop();
  });

  it("records only named actions: no nameless one, no query, no transition (#Q4106)", async () => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", APP_SECRET: "test", SERVER_PORT: 0 },
    });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();

    const run = async (ev: { type: string; id?: string }) => {
      await (alepha.events as any).emit("react:action:begin", ev);
      await (alepha.events as any).emit("react:action:success", ev);
    };
    await run({ type: "custom" });
    await run({ type: "form" });
    await run({ type: "query", id: '["users",1]' });
    await run({ type: "transition", id: "settings" });
    await run({ type: "custom", id: "saveSettings" });
    await run({ type: "form", id: "login" });

    expect(provider.trail.snapshot().actions.map((it) => it.name)).toEqual([
      "saveSettings",
      "login",
    ]);
    await alepha.stop();
  });
});
