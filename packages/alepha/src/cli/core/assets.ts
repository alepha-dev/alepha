import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(import.meta.url), "../../../..");

export const cliAssets = {
  devtools: join(packageRoot, "assets/devtools-ui"),
  logo: join(packageRoot, "assets/logo.svg"),
};
