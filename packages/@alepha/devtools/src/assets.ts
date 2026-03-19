import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const devtoolsAssets = {
  ui: join(fileURLToPath(import.meta.url), "../../assets/ui"),
};
