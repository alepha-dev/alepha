import { mkdirSync } from "node:fs";
import { $atom, Alepha, z } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";
import { beforeAll, describe, expect, it } from "vitest";
import { AlephaDevtools } from "../index.ts";

// Outside production the module serves its built UI from `assets/ui`, which is a
// gitignored build artifact (absent in CI). ServerStaticProvider would fail to
// boot on the missing directory. This spec only exercises the atoms API route,
// so make the static root exist as an empty directory (mirrors production-guard.spec.ts).
beforeAll(() => {
  mkdirSync(new URL("../../assets/ui", import.meta.url), { recursive: true });
});

const testAtom = $atom({
  name: "test.devtools.atoms.settings",
  schema: z.object({ theme: z.string() }),
  default: { theme: "light" },
});

const boot = async () => {
  const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
    .with(AlephaServer)
    .with(AlephaDevtools);
  await alepha.start();
  return alepha;
};

const postAtom = (alepha: Alepha, body: { name: string; value: unknown }) =>
  fetch(`${alepha.inject(ServerProvider).hostname}/__devtools/api/atoms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("DevToolsProvider — POST /__devtools/api/atoms", () => {
  // Note: each HTTP request runs inside its own ALS fork (ServerProvider
  // wraps request handling in `alepha.context.run(...)`), and
  // `StateManager.set()` prefers the ALS layer when one exists. So a write
  // made from inside this route's handler never reaches the app-level
  // store — it lives and dies with the request. That's a pre-existing,
  // unrelated behavior of this route (not introduced by, or in scope for,
  // this fix pass), so these tests assert the route's response contract
  // only, not cross-request persistence of the written value.

  it("accepts a valid value for a registered atom", async () => {
    const alepha = await boot();
    alepha.store.get(testAtom); // register the atom

    const resp = await postAtom(alepha, {
      name: testAtom.key,
      value: { theme: "dark" },
    });

    expect(resp.status).toBe(200);
    expect(await resp.json()).toStrictEqual({ success: true });

    await alepha.stop();
  });

  it("rejects an invalid value with success:false and a diagnosable message instead of a 500", async () => {
    const alepha = await boot();
    alepha.store.get(testAtom); // register the atom

    const resp = await postAtom(alepha, {
      name: testAtom.key,
      value: { theme: 42 },
    });

    // Before this fix, an invalid value threw a SchemaValidationError out of the
    // handler (an uncaught 500). The catch must turn it into a normal
    // success:false response, with a message so the devtools UI can show
    // *why* the edit was rejected instead of a silent, unexplained failure.
    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.success).toBe(false);
    expect(typeof json.message).toBe("string");
    expect(json.message.length).toBeGreaterThan(0);

    await alepha.stop();
  });

  it("returns success:false with a message for an unknown atom name", async () => {
    const alepha = await boot();

    const resp = await postAtom(alepha, {
      name: "does.not.exist",
      value: 1,
    });

    expect(resp.status).toBe(200);
    const json = await resp.json();
    expect(json.success).toBe(false);
    expect(typeof json.message).toBe("string");
    expect(json.message).toContain("does.not.exist");

    await alepha.stop();
  });
});
