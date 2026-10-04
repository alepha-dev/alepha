import { join } from "node:path";

/**
 * The `npx @alepha/devtools` bin, built for node with its shebang kept. The
 * package exports nothing to import: it is a tool, run rather than installed.
 */
export default () => {
  const root = process.cwd();
  return [
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
