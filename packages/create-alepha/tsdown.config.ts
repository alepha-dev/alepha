import { join } from "node:path";

export default {
  entry: join(import.meta.dirname, "src/index.ts"),
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  fixedExtension: false,
  outDir: join(import.meta.dirname, "dist"),
  dts: true,
};
