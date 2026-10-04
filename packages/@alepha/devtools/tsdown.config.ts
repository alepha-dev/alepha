import { join } from "node:path";

import base from "../../../tsdown.config.ts";

/**
 * The library entries every package gets, plus the `npx @alepha/devtools`
 * bin, built for node with its shebang kept.
 */
export default async () => {
  const root = process.cwd();
  const configs = await base();
  return [
    ...configs,
    {
      entry: { bin: join(root, "src/bin.ts") },
      format: ["esm"],
      platform: "node",
      sourcemap: true,
      fixedExtension: false,
      outDir: join(root, "dist"),
      dts: false,
      deps: { neverBundle: [/^alepha(\/|$)/, /^zod(\/|$)/] },
    },
  ];
};
