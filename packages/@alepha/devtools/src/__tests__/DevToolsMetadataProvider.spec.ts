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

/**
 * `serverOnly` is reported, not enforced, on this route.
 *
 * The flag keeps a value out of the *application's* SSR hydration payload. It
 * is not a general secrecy marker, and devtools is not the application: the
 * module refuses to register in production precisely because it already serves
 * the whole environment — every secret in it — in cleartext, and its own atom
 * route already accepts writes to these same atoms. Redacting the read while
 * permitting the write left the one screen that exists to show server state
 * unable to show it.
 */
describe("DevToolsMetadataProvider — GET /__devtools/api/metadata (atoms)", () => {
  it("reports a serverOnly atom's value, and the flag alongside it", async () => {
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

    // The flag is still reported — it drives the Server/Hybrid grouping and
    // the "channels to the browser" panel...
    expect(secretMeta).toBeDefined();
    expect(secretMeta?.serverOnly).toBe(true);
    // ...and it no longer redacts. Devtools reads server state off the server.
    expect(secretMeta?.defaultValue).toBe("s3cret");
    expect(secretMeta?.currentValue).toBe("s3cret");

    // A normal atom is unaffected.
    expect(normalMeta).toBeDefined();
    expect(normalMeta?.serverOnly).toBeUndefined();
    expect(normalMeta?.defaultValue).toBe("visible");
    expect(normalMeta?.currentValue).toBe("visible");

    await alepha.stop();
  });
});
