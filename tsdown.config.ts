import { access } from "node:fs/promises";
import { join } from "node:path";

export default async () => {
  const root = process.cwd();
  const hasBrowser = await access(join(root, "src/index.browser.ts"))
    .then(() => true)
    .catch(() => false);

  if (hasBrowser) {
    return [
      {
        entry: join(root, "src/index.ts"),
        format: ["esm"],
        sourcemap: true,
        fixedExtension: false,
        outDir: join(root, "dist"),
        dts: true,
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
    },
  ];
};
