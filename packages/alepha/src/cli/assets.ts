import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const cliAssets = {
  devtools: join(fileURLToPath(import.meta.url), "../../../assets/devtools-ui"),
};
