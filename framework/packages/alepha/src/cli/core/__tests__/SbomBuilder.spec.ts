import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { SbomBuilder } from "../services/SbomBuilder.ts";

/**
 * A project with three packages installed: two the bundle reaches, one it
 * never does (a test runner, the dev-only case), plus a workspace package
 * marked private and a nested `{ "type": "module" }` that names nothing.
 */
const fixture = async () => {
  const alepha = Alepha.create().with({
    provide: FileSystemProvider,
    use: MemoryFileSystemProvider,
  });
  const fs = alepha.inject(MemoryFileSystemProvider);
  const sbom = alepha.inject(SbomBuilder);
  const json = (path: string, value: unknown) =>
    fs.writeFile(path, JSON.stringify(value));

  await json("/app/package.json", { name: "my-app", version: "0.0.0" });
  await json("/app/node_modules/react/package.json", {
    name: "react",
    version: "19.2.0",
    license: "MIT",
  });
  await json("/app/node_modules/@scope/util/package.json", {
    name: "@scope/util",
    version: "1.2.3",
    license: "Apache-2.0 OR MIT",
  });
  await json("/app/node_modules/@scope/util/dist/package.json", {
    type: "module",
  });
  await json("/app/node_modules/odd-license/package.json", {
    name: "odd-license",
    version: "2.0.0",
    license: "SEE LICENSE IN LICENSE.md",
  });
  await json("/app/node_modules/vitest/package.json", {
    name: "vitest",
    version: "5.1.0",
    license: "MIT",
  });
  await json("/repo/packages/internal/package.json", {
    name: "@app/internal",
    version: "1.0.0",
    private: true,
  });
  await json("/app/dist/package.json", {
    dependencies: { sharp: "^0.34.0" },
  });

  // What two builds emitted: the client and one server slice.
  const plugin = sbom.plugin();
  plugin.generateBundle(
    {},
    {
      "entry.js": {
        type: "chunk",
        moduleIds: [
          "/app/src/main.browser.ts",
          "/app/node_modules/react/index.js",
          "\0vite/preload-helper",
        ],
      },
      "style.css": { type: "asset" },
    },
  );
  plugin.generateBundle(
    {},
    {
      "abc.js": {
        type: "chunk",
        moduleIds: [
          "/app/src/main.server.ts",
          "/app/node_modules/react/cjs/react.production.js",
          "/app/node_modules/@scope/util/dist/index.js?commonjs-es-import",
          "/app/node_modules/odd-license/index.js",
          "/repo/packages/internal/src/index.ts",
        ],
      },
    },
  );

  await sbom.write({
    root: "/app",
    distDir: "dist",
    project: "my-app",
    version: "1.4.0",
  });
  const document = JSON.parse(
    fs.getFileContent(`/app/dist/${SbomBuilder.FILE}`) ?? "{}",
  );
  return { document, sbom };
};

describe("SbomBuilder", () => {
  it("writes a CycloneDX 1.6 document naming the app as its component", async () => {
    const { document } = await fixture();
    expect(document.bomFormat).toBe("CycloneDX");
    expect(document.specVersion).toBe("1.6");
    expect(document.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(document.metadata.component).toEqual({
      type: "application",
      "bom-ref": "app:my-app",
      name: "my-app",
      version: "1.4.0",
    });
    expect(document.metadata.tools.components[0].name).toBe("alepha");
  });

  it("lists every package the bundles reached, once, from both builds", async () => {
    const { document } = await fixture();
    expect(document.components.map((it: { purl: string }) => it.purl)).toEqual([
      "pkg:npm/%40scope/util@1.2.3",
      "pkg:npm/odd-license@2.0.0",
      "pkg:npm/react@19.2.0",
      "pkg:npm/sharp@0.34.0",
    ]);
  });

  it("leaves out a package the bundle never reached, the app, and a private workspace package", async () => {
    const { document } = await fixture();
    const names = document.components.map((it: { name: string }) => it.name);
    expect(names).not.toContain("vitest");
    expect(names).not.toContain("my-app");
    expect(names).not.toContain("@app/internal");
  });

  it("carries name, version, purl and license as the schema accepts them", async () => {
    const { document } = await fixture();
    const byName = Object.fromEntries(
      document.components.map((it: { name: string }) => [it.name, it]),
    );
    expect(byName.react).toEqual({
      type: "library",
      "bom-ref": "pkg:npm/react@19.2.0",
      name: "react",
      version: "19.2.0",
      purl: "pkg:npm/react@19.2.0",
      licenses: [{ expression: "MIT" }],
    });
    expect(byName["@scope/util"].licenses).toEqual([
      { expression: "Apache-2.0 OR MIT" },
    ]);
    // Not an SPDX value: a name, which the schema does not check.
    expect(byName["odd-license"].licenses).toEqual([
      { license: { name: "SEE LICENSE IN LICENSE.md" } },
    ]);
    // An external with nothing installed: the declared range, no license.
    expect(byName.sharp.licenses).toBeUndefined();
  });

  it("forgets the previous build after a reset", async () => {
    const { sbom } = await fixture();
    expect(sbom.collected().length).toBeGreaterThan(0);
    sbom.reset();
    expect(sbom.collected()).toEqual([]);
  });
});
