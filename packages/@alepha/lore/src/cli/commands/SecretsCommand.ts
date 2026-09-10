import { $inject, AlephaError, z } from "alepha";
import { $command, EnvUtils } from "alepha/command";
import { $logger } from "alepha/logger";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";
import type { AppController } from "lore/api/controllers/AppController";
import type { AppSecretController } from "lore/api/controllers/AppSecretController";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * A deployed copy's secrets, from a terminal or a CI job.
 *
 * ```bash
 * lore secrets set STRIPE_SECRET_KEY=sk_test_... --app platform --env staging
 * lore secrets set STRIPE_SECRET_KEY --app platform --env staging   # value from $STRIPE_SECRET_KEY
 * lore secrets set --file .env.staging --app platform --env staging
 * lore secrets list --app platform --env staging
 * lore secrets unset STRIPE_SECRET_KEY --app platform --env staging
 * ```
 *
 * Lore keeps them sealed, one set per copy, and uploads the whole set on every
 * deploy: setting one here takes effect on the copy's next deploy, and a
 * deploy needs nothing from the machine that runs it.
 *
 * ## ⚠️ `--env` is never guessed
 *
 * Unlike `deploy`, these commands do not fall back to `LORE_ENV` or to an
 * app's only copy. `set --file .env.staging` in an app whose only copy is
 * production would otherwise write staging's secrets into production, and the
 * word would never appear on screen.
 *
 * ## ⚠️ A value is never printed
 *
 * Not by `set`, not by `list` (which shows Lore's masked prefix), not in an
 * error. A CI log is read by more people than the secret was meant for.
 */
export class SecretsCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);

  protected readonly apps = $client<AppController>(this.client.scope());
  protected readonly secrets = $client<AppSecretController>(
    this.client.scope(),
  );

  /**
   * Keys a `--file` import leaves alone.
   *
   * `SIGIL_KEY` is minted by Lore for each copy and stored as one of its
   * secrets; an env file carrying an older key would silently point the copy
   * at somebody else's sigil. Setting it one by one still works, because that
   * is somebody saying so.
   */
  public static readonly IMPORT_SKIPPED: ReadonlySet<string> = new Set([
    "SIGIL_KEY",
  ]);

  protected static readonly TARGET_FLAGS = {
    project: z
      .text({
        aliases: ["p"],
        description: "Lore project slug, overriding LORE_PROJECT.",
      })
      .optional(),
    app: z
      .text({
        description:
          "App name. Defaults to the slugified `name` from package.json.",
      })
      .optional(),
    env: z.text({
      aliases: ["e"],
      description: "Which deployed copy. Required: it is never guessed.",
    }),
  };

  public readonly set = $command({
    name: "set",
    description:
      "Set one secret (KEY=VALUE, or KEY to read $KEY), or every one in --file",
    args: z
      .text({
        description:
          "KEY=VALUE, or KEY alone to take the value of that variable from the environment.",
      })
      .optional(),
    flags: z.object({
      ...SecretsCommand.TARGET_FLAGS,
      file: z
        .text({
          aliases: ["f"],
          description:
            "A dotenv file (e.g. .env.staging) whose every key is set, SIGIL_KEY aside.",
        })
        .optional(),
    }),
    handler: async ({ args, flags, root }) => {
      if (!args === !flags.file) {
        throw new AlephaError(
          "Pass one secret as KEY=VALUE (or KEY to read $KEY), or --file with a dotenv file. Not both, and not neither.",
        );
      }

      const pairs = flags.file
        ? await this.readFile(root, flags.file)
        : [this.readPair(args as string)];
      const { projectId, instanceId, label } = await this.target(flags, root);

      const refused: string[] = [];
      let set = 0;
      for (const [key, value] of pairs) {
        try {
          await this.secrets.setAppSecret({
            params: { projectId, instanceId },
            body: { key, value },
          });
          set += 1;
          this.log.info(`Set ${key} on ${label}`);
        } catch (error) {
          // Lore's own sentence says which rule refused the key (a reserved
          // name, an oversized value); the value is not in it.
          if (error instanceof HttpError) {
            refused.push(`${key}: ${error.message}`);
            continue;
          }
          throw error;
        }
      }

      this.log.info(
        `${set} secret${set === 1 ? "" : "s"} set on ${label}. They apply on its next deploy.`,
      );
      if (refused.length > 0) {
        throw new AlephaError(
          `Lore refused ${refused.length}: ${refused.join("; ")}`,
        );
      }
    },
  });

  public readonly list = $command({
    name: "list",
    description: "List a copy's secrets, masked",
    flags: z.object(SecretsCommand.TARGET_FLAGS),
    handler: async ({ flags, root }) => {
      const { projectId, instanceId, label } = await this.target(flags, root);
      const { items } = await this.secrets.listAppSecrets({
        params: { projectId, instanceId },
      });
      if (items.length === 0) {
        this.log.info(`${label} has no secrets.`);
        return;
      }
      for (const secret of items) {
        this.log.info(`${secret.key}  ${secret.valuePrefix ?? ""}…`);
      }
    },
  });

  public readonly unset = $command({
    name: "unset",
    description: "Remove one secret from a copy",
    args: z.text({ description: "The key to remove." }),
    flags: z.object(SecretsCommand.TARGET_FLAGS),
    handler: async ({ args, flags, root }) => {
      const { projectId, instanceId, label } = await this.target(flags, root);
      await this.secrets.deleteAppSecret({
        params: { projectId, instanceId, key: args },
      });
      this.log.info(
        `Removed ${args} from ${label}. It is gone on its next deploy.`,
      );
    },
  });

  public readonly secretsCommand = $command({
    name: "secrets",
    description: "Set, list and remove a deployed copy's secrets",
    children: [this.set, this.list, this.unset],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * `KEY=VALUE`, or `KEY` alone for the variable of that name.
   *
   * The second form keeps the value out of shell history, and is what a CI
   * step uses: the job's `env:` carries the secret, the command names it.
   */
  protected readPair(arg: string): [string, string] {
    const equals = arg.indexOf("=");
    const key = (equals === -1 ? arg : arg.slice(0, equals)).trim();
    const value = equals === -1 ? process.env[key] : arg.slice(equals + 1);
    if (!key) {
      throw new AlephaError(`"${arg}" names no key. Pass KEY=VALUE.`);
    }
    if (!value) {
      throw new AlephaError(
        equals === -1
          ? `${key} is not set in this environment, so there is no value to send. Pass ${key}=VALUE, or export it first.`
          : `${key} has no value. Remove it with \`lore secrets unset ${key}\` instead: an empty variable and an absent one are different things to an app.`,
      );
    }
    return [key, value];
  }

  /**
   * Every key of a dotenv file, in the order it declares them.
   *
   * An empty value is dropped rather than sent, for the reason `readPair`
   * refuses one, and so is {@link IMPORT_SKIPPED}; both are said out loud.
   */
  protected async readFile(
    root: string,
    file: string,
  ): Promise<Array<[string, string]>> {
    if (!(await this.fs.exists(this.fs.join(root, file)))) {
      throw new AlephaError(`${file} does not exist.`);
    }
    const vars = await this.envUtils.parseEnv(root, [file]);
    const pairs: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(vars)) {
      if (SecretsCommand.IMPORT_SKIPPED.has(key)) {
        this.log.info(
          `Kept Lore's ${key}: a copy's own is minted by Lore. Set it one by one to override it.`,
        );
        continue;
      }
      if (!value) {
        this.log.info(`Skipped ${key}: it has no value in ${file}.`);
        continue;
      }
      pairs.push([key, value]);
    }
    if (pairs.length === 0) {
      throw new AlephaError(`${file} has no secret to set.`);
    }
    return pairs;
  }

  /**
   * The copy a command is about, refused by name when it does not exist.
   *
   * Never created: a secret written to a copy nobody made is a typo, and
   * `lore deploy` refuses the same way.
   */
  protected async target(
    flags: { project?: string; app?: string; env: string },
    root: string,
  ): Promise<{ projectId: number; instanceId: string; label: string }> {
    const project = this.client.resolveProject(flags.project);
    const projectId = await this.projects.resolve(project);
    const app = await this.projects.resolveApp(flags.app, root);
    const env = flags.env.trim();
    const label = `${app}/${env}`;

    try {
      const instance = await this.apps.getApp({
        params: { projectId, app, env },
      });
      if (instance?.id) {
        return { projectId, instanceId: instance.id, label };
      }
    } catch (error) {
      if (!HttpError.is(error, 404)) {
        throw error;
      }
    }
    throw new AlephaError(
      `${label} is not a deployed copy of this project. Create it on the project's Apps page first; a secret set here would have nowhere to go.`,
    );
  }
}
