import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, it } from "vitest";

/**
 * The WebCrypto half of the GitHub integration on workerd (#Q4363): the PKCS#1
 * key converted, the App JWT signed and the webhook HMAC checked, bundled
 * with the `workerd` conditions as `alepha build` does and run in Miniflare
 * under the build's compatibility date. Node runs the same code in
 * `github-tokens.spec.ts`; the JWT signed here is verified there by Node.
 */
describe("the GitHub App's crypto on workerd", () => {
  it("converts GitHub's key, signs a JWT Node verifies, and checks a webhook signature", async ({
    expect,
  }) => {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const services = resolve(import.meta.dirname, "../src/api/services");
    const source = `
import { Alepha } from "alepha";
import { GitHubAppJwt } from "${services}/GitHubAppJwt.ts";
import { GitHubKeyFormat } from "${services}/GitHubKeyFormat.ts";
import { GitHubWebhookSignature } from "${services}/GitHubWebhookSignature.ts";
export default { async fetch(request) {
  const input = await request.json();
  const alepha = Alepha.create();
  const keys = alepha.inject(GitHubKeyFormat);
  const pem = keys.toPkcs8Pem(input.pem);
  const jwt = await alepha.inject(GitHubAppJwt).sign("4242", pem);
  const signatures = alepha.inject(GitHubWebhookSignature);
  const body = new TextEncoder().encode(input.body);
  const header = await signatures.sign(body, "webhook-secret");
  return Response.json({
    pkcs8: pem.startsWith("-----BEGIN PRIVATE KEY-----"),
    jwt,
    good: await signatures.verify(body, header, "webhook-secret"),
    bad: await signatures.verify(body, header, "another-secret"),
  });
} };
`;
    const result = await runInWorkerd(source, {
      pem: pair.privateKey,
      body: '{"action":"opened"}',
    });

    expect(result.pkcs8).toBe(true);
    expect(result.good).toBe(true);
    expect(result.bad).toBe(false);

    const [header, payload, signature] = result.jwt.split(".");
    const bytes = (text: string) =>
      Uint8Array.from(
        atob(text.replace(/-/g, "+").replace(/_/g, "/")),
        (char) => char.charCodeAt(0),
      );
    const publicKey = await crypto.subtle.importKey(
      "spki",
      bytes(pair.publicKey.replace(/-----[A-Z ]+-----|\s+/g, "")),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        bytes(signature),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(bytes(payload))).iss).toBe(
      "4242",
    );
  }, 120_000);
});

/**
 * Bundles `source` for workerd and answers one POST of `body` to it.
 */
const runInWorkerd = async (source: string, body: unknown): Promise<any> => {
  const dir = await mkdtemp(join(tmpdir(), "lore-github-workerd-"));
  const cache = join(process.cwd(), "node_modules/.alepha");
  await mkdir(cache, { recursive: true });
  const entry = join(cache, `github-workerd-${process.pid}.ts`);
  await writeFile(entry, source);
  let runtime: Miniflare | undefined;
  try {
    await build({
      configFile: false,
      publicDir: false,
      logLevel: "silent",
      plugins: [
        {
          name: "stub-bun-modules",
          enforce: "pre",
          resolveId: (id: string) => (id.startsWith("bun:") ? `\0${id}` : null),
          load: (id: string) =>
            id.startsWith("\0bun:")
              ? "export const Database = undefined; export default {};"
              : null,
        },
      ],
      ssr: {
        noExternal: true,
        resolve: { conditions: ["workerd", "module"] },
      },
      build: {
        ssr: entry,
        outDir: dir,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          external: [/^cloudflare:/, /^node:/],
          output: {
            entryFileNames: "worker.js",
            codeSplitting: false,
            format: "esm",
          },
        },
      },
    });
    const script = await readFile(join(dir, "worker.js"), "utf8");
    runtime = new Miniflare({
      port: 0,
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            name: "github",
            // The date and flags `alepha build` writes.
            compatibilityDate: "2026-11-03",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "worker.js",
              modules: { "worker.js": { type: "esm", contents: script } },
            },
          },
        },
      ],
    });
    const response = await runtime.dispatchFetch("http://github.test/", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return await response.json();
  } finally {
    await runtime?.dispose();
    await rm(dir, { recursive: true, force: true });
    await rm(entry, { force: true });
  }
};
