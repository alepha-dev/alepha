import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SDKResult } from "@capgo/cli/sdk";
import { afterAll, describe, it } from "vitest";

import { OtaArchiveWriter } from "../../cli/services/OtaArchiveWriter.ts";
import { OtaEnvelope } from "../../cli/services/OtaEnvelope.ts";
import { OtaBundleInspector } from "../services/OtaBundleInspector.ts";

/**
 * The bytes our publisher writes and our server reads, against the pinned
 * Capgo tooling (`@capgo/cli` 8.75.2, its SDK): each side opens what the
 * other sealed. The device side of the same contract is the pinned plugin,
 * proven on simulators and devices (#Q2524's evidence folio).
 *
 * The SDK reads `capacitor.config.json` and `package.json` from its working
 * directory (the updater version picks the checksum format), so it runs in a
 * child process inside a scratch project.
 */
const sdk = import.meta.resolve("@capgo/cli/sdk");
const project = mkdtempSync(join(tmpdir(), "alepha-ota-capgo-"));
const envelope = new OtaEnvelope();
const inspector = new OtaBundleInspector();
// Test-only keys, made per run and never written outside the scratch project.
const keys = envelope.generateKeyPair();

writeFileSync(
  join(project, "capacitor.config.json"),
  JSON.stringify({
    appId: "dev.alepha.ota.conformance",
    appName: "conformance",
    webDir: "www",
    plugins: { CapacitorUpdater: { publicKey: keys.publicKey } },
  }),
);
writeFileSync(
  join(project, "package.json"),
  JSON.stringify({
    name: "conformance",
    private: true,
    dependencies: { "@capgo/capacitor-updater": "8.52.1" },
  }),
);

const capgo = (call: "encryptBundle" | "decryptBundle", options: object) => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const sdk = await import(${JSON.stringify(sdk)});
       const result = await sdk.${call}(JSON.parse(process.env.OPTIONS));
       process.stdout.write("\\n@@" + JSON.stringify(result));`,
    ],
    {
      cwd: project,
      env: {
        ...process.env,
        OPTIONS: JSON.stringify(options),
        CAPGO_DISABLE_TELEMETRY: "1",
      },
      encoding: "utf-8",
    },
  );
  const result = JSON.parse(output.slice(output.lastIndexOf("@@") + 2));
  if (!result.success) {
    throw new Error(`capgo ${call}: ${JSON.stringify(result)}`);
  }
  return result.data;
};

const bundle = new OtaArchiveWriter().write([
  { path: "index.html", data: new TextEncoder().encode("<!doctype html>") },
  { path: "assets/app.js", data: new TextEncoder().encode("console.log(1)") },
]);

describe("OTA envelope against the pinned Capgo tooling", () => {
  afterAll(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("decrypts what our publisher seals, checksum included", ({ expect }) => {
    const sealed = envelope.seal(bundle, keys.privateKey);
    writeFileSync(join(project, "ours.zip"), sealed.ciphertext);

    const result = capgo("decryptBundle", {
      zipPath: "ours.zip",
      ivSessionKey: sealed.sessionKey,
      keyData: keys.publicKey,
      checksum: sealed.checksum,
      packageJson: "package.json",
    });

    expect(result.checksumMatches).toBe(true);
    expect(
      new Uint8Array(readFileSync(join(project, result.outputPath))),
    ).toEqual(bundle);
  });

  it("lets our server open what Capgo seals", async ({ expect }) => {
    writeFileSync(join(project, "theirs.zip"), bundle);
    const result: NonNullable<
      SDKResult<{
        filename: string;
        ivSessionKey: string;
        checksum: string;
      }>["data"]
    > = capgo("encryptBundle", {
      zipPath: "theirs.zip",
      checksum: envelope.sha256(bundle),
      keyData: keys.privateKey,
      packageJson: "package.json",
    });

    const opened = await inspector.open({
      ciphertext: new Uint8Array(readFileSync(join(project, result.filename))),
      sessionKey: result.ivSessionKey,
      checksum: result.checksum,
      publicKey: keys.publicKey,
    });

    expect(opened.archive).toEqual(bundle);
    expect(opened.archiveSha256).toBe(envelope.sha256(bundle));
  });

  it("computes the plugin's key identity", ({ expect }) => {
    // The plugin's `calcKeyId`: the first 20 base64 characters of the
    // PKCS#1 body, the first 12 of which every 2048-bit key shares.
    expect(envelope.keyId(keys.publicKey)).toHaveLength(20);
    expect(envelope.keyId(keys.publicKey).startsWith("MIIBCgKCAQEA")).toBe(
      true,
    );
    expect(inspector.keyId(keys.publicKey)).toBe(
      envelope.keyId(keys.publicKey),
    );
  });
});
