import { mkdirSync } from "node:fs";
import { $atom, Alepha, z } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";
import { beforeAll, describe, expect, it } from "vitest";
import { AlephaDevtools } from "../index.ts";

// Outside production the module serves its built UI from `assets/ui`, which is a
// gitignored build artifact (absent in CI). ServerStaticProvider would fail to
// boot on the missing directory. This spec only exercises the metadata route,
// so make the static root exist as an empty directory (mirrors production-guard.spec.ts).
beforeAll(() => {
  mkdirSync(new URL("../../assets/ui", import.meta.url), { recursive: true });
});

const secretAtom = $atom({
  name: "test.devmeta.secret",
  schema: z.string(),
  default: "s3cret",
  serverOnly: true,
});

const normalAtom = $atom({
  name: "test.devmeta.normal",
  schema: z.string(),
  default: "visible",
});

describe("DevToolsMetadataProvider — GET /__devtools/api/metadata (atoms)", () => {
  it("lists a serverOnly atom but omits its defaultValue/currentValue", async () => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaServer)
      .with(AlephaDevtools);
    await alepha.start();

    // Register both atoms so they show up in the metadata snapshot.
    alepha.store.get(secretAtom);
    alepha.store.get(normalAtom);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/__devtools/api/metadata`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      atoms: Array<{
        name: string;
        serverOnly?: boolean;
        defaultValue?: unknown;
        currentValue?: unknown;
      }>;
    };

    const secretMeta = json.atoms.find((a) => a.name === secretAtom.key);
    const normalMeta = json.atoms.find((a) => a.name === normalAtom.key);

    // The atom's existence and schema are still discoverable...
    expect(secretMeta).toBeDefined();
    expect(secretMeta?.serverOnly).toBe(true);
    // ...but its value never reaches this dev-only response.
    expect(secretMeta?.defaultValue).toBeUndefined();
    expect(secretMeta?.currentValue).toBeUndefined();

    // A normal atom is unaffected.
    expect(normalMeta).toBeDefined();
    expect(normalMeta?.serverOnly).toBeUndefined();
    expect(normalMeta?.defaultValue).toBe("visible");
    expect(normalMeta?.currentValue).toBe("visible");

    await alepha.stop();
  });
});
