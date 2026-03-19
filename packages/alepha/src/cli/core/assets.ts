import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(import.meta.url), "../../../..");

export const cliAssets = {
  logo: join(packageRoot, "assets/logo.svg"),
};
