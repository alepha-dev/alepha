import { access } from "node:fs/promises";
import { join } from "node:path";

export default async () => {
  const root = process.cwd();
  const hasBrowser = await access(join(root, "src/index.browser.ts"))
    .then(() => true)
    .catch(() => false);

  // zod is a runtime dependency, never bundled. Its `v4/locales/*.d.cts` type
  // files use CommonJS dts syntax that rolldown-plugin-dts cannot bundle, so it
  // must be external for both the JS bundle (`neverBundle`) and the .d.ts bundle
  // (`dts.neverBundle` — tsdown externalizes those separately).
  const zod = /^zod(\/|$)/;
  const deps = { neverBundle: [zod], dts: { neverBundle: [zod] } };

  if (hasBrowser) {
    return [
      {
        entry: join(root, "src/index.ts"),
        format: ["esm"],
        sourcemap: true,
        fixedExtension: false,
        outDir: join(root, "dist"),
        dts: true,
        deps,
      },
      {
        entry: join(root, "src/index.browser.ts"),
        platform: "browser",
        sourcemap: true,
        dts: false,
        outDir: join(root, "dist"),
      },
    ];
  }

  return [
    {
      entry: join(root, "src/index.ts"),
      format: ["esm"],
      platform: "neutral", // TODO: index.node.ts for node specific build
      sourcemap: true,
      fixedExtension: false,
      outDir: join(root, "dist"),
      dts: true,
      deps,
    },
  ];
};
