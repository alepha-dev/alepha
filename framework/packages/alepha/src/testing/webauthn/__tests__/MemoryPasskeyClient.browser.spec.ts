import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { MemoryPasskeyClient } from "../MemoryPasskeyClient.ts";

const options = { challenge: "Y2hhbGxlbmdl", rpId: "localhost" };

describe("MemoryPasskeyClient conditional get", () => {
  it("cancels at once on a signal already aborted, as a browser does", async ({
    expect,
  }) => {
    const client = Alepha.create().inject(MemoryPasskeyClient);
    const controller = new AbortController();
    controller.abort();

    const result = await Promise.race([
      client.get(options, {
        mediation: "conditional",
        signal: controller.signal,
      }),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 200)),
    ]);

    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(client.pending).toHaveLength(0);
    expect(client.calls.aborted).toBe(1);
  });

  it("does not count an abort that comes after the user picked a passkey", async ({
    expect,
  }) => {
    const client = Alepha.create().inject(MemoryPasskeyClient);
    const controller = new AbortController();

    const pending = client.get(options, {
      mediation: "conditional",
      signal: controller.signal,
    });
    await client.pickAutofill().catch(() => undefined);
    await pending;
    controller.abort();

    expect(client.calls.aborted).toBe(0);
  });
});
