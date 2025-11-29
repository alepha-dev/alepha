import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Alepha, AlephaError } from "alepha";
import { importVite } from "./importVite.ts";

/**
 * Import Alepha instance from a transpiled server entry file.
 */
export const importAlepha = async (
  entry: string,
  options?: {
    env: Record<string, string>;
  },
): Promise<Alepha> => {
  if (global.__cli_alepha) {
    return global.__cli_alepha as Alepha;
  }

  const { loadEnv } = await importVite();

  const env = loadEnv("development", process.cwd(), "");

  for (const key in env) {
    process.env[key] = env[key];
  }

  if (options?.env) {
    for (const key in options.env) {
      process.env[key] = options.env[key];
    }
  }

  process.env.ALEPHA_CLI_IMPORT = "true";
  process.env.LOG_LEVEL = "error";
  process.env.LOG_FORMAT = "pretty";
  process.env.NODE_ENV = "production";

  const entryFile = pathToFileURL(join(process.cwd(), entry)).href;
  const mod = await import(entryFile);

  // check if alepha is correctly exported
  if (mod.default) {
    return mod.default;
  }

  // else, try with global variable
  const alepha = global.__cli_alepha as Alepha | undefined;
  if (!alepha) {
    throw new AlephaError(
      "Alepha instance not found. Ensure Alepha is initialized.",
    );
  }

  return alepha;
};
