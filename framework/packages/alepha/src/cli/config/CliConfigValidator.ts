import { AlephaError, z } from "alepha";
import {
  appEntryOptions,
  buildOptions,
  checkOptions,
  desktopOptions,
  devOptions,
  imageOptions,
  metaOptions,
} from "alepha/cli";

import type { AlephaCliConfig } from "./defineConfig.ts";
import { retiredConfigKeys } from "./retiredConfigKeys.ts";
import { StrictConfigSchema } from "./StrictConfigSchema.ts";

/**
 * The config boundary, using the same schemas as the CLI's atoms.
 */
export class CliConfigValidator {
  protected static readonly schema = z
    .object({
      entry: StrictConfigSchema.from(appEntryOptions.schema).optional(),
      build: StrictConfigSchema.from(
        buildOptions.schema.omit({ runtimes: true }),
      ).optional(),
      // `check: false` is taken out before this schema runs (see `parse`):
      // as a union, a wrong key inside the object reported "check: Invalid
      // input" instead of naming the key.
      check: StrictConfigSchema.from(
        checkOptions.schema.omit({ enabled: true }),
      ).optional(),
      dev: StrictConfigSchema.from(devOptions.schema).optional(),
      desktop: StrictConfigSchema.from(desktopOptions.schema).optional(),
      image: StrictConfigSchema.from(imageOptions.schema).optional(),
      meta: StrictConfigSchema.from(metaOptions.schema).optional(),
      plugins: z.array(z.any()).optional(),
      env: z.record(z.string(), z.any()).optional(),
    })
    .strict();

  public static parse(input: unknown): AlephaCliConfig {
    const checkDisabled =
      typeof input === "object" &&
      input !== null &&
      (input as { check?: unknown }).check === false;
    const result = this.schema.safeParse(
      checkDisabled ? { ...input, check: undefined } : input,
    );
    if (result.success) {
      return (
        checkDisabled ? { ...result.data, check: false } : result.data
      ) as AlephaCliConfig;
    }
    const messages = result.error.issues.flatMap((issue) => {
      const paths =
        issue.code === "unrecognized_keys"
          ? issue.keys.map((key) => [...issue.path, key].join("."))
          : [issue.path.join(".") || "(root)"];
      return paths.map((path) => {
        const replacement = Object.hasOwn(retiredConfigKeys, path)
          ? retiredConfigKeys[path]
          : undefined;
        return replacement
          ? `${path} was removed; use ${replacement}`
          : `${path}: ${issue.message}`;
      });
    });
    throw new AlephaError(`Invalid alepha.config.ts: ${messages.join("; ")}`);
  }
}
