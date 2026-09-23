import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import type { AppSecretController } from "lore/api/controllers/AppSecretController";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * Write secrets into one deployed copy's sealed set: what `lore secrets set`
 * does, and what the platform adapter does before it deploys.
 *
 * ## ⚠️ Additive, always
 *
 * Every key given is written, and a key Lore holds that was not given is left
 * alone. Nothing here lists the copy's set in order to prune it: a value
 * somebody set in the Lore UI must survive a push from a file that never knew
 * about it.
 *
 * ## ⚠️ A value is never printed
 *
 * Not on success, not in a refusal (Lore's sentence names the rule, never the
 * value). A CI log is read by more people than the secret was meant for.
 */
export class LoreSecretsService {
  protected readonly log = $logger();
  protected readonly client = $inject(LoreClientService);

  /**
   * ⚠️ Declared after `client`: a field initializer reading another field sees
   * `undefined` if that field is declared below it.
   */
  protected readonly secrets = $client<AppSecretController>(
    this.client.scope(),
  );

  /**
   * Keys an import leaves alone.
   *
   * `SIGIL_KEY` is minted by Lore for each copy and stored as one of its
   * secrets; an env file carrying an older key would silently point the copy
   * at somebody else's sigil. Setting it one by one still works, because that
   * is somebody saying so.
   */
  public static readonly IMPORT_SKIPPED: ReadonlySet<string> = new Set([
    "SIGIL_KEY",
  ]);

  /**
   * The pairs of a set of variables worth sending, each skip said out loud.
   *
   * {@link IMPORT_SKIPPED} and empty values are always dropped. `reserved`
   * drops more, on the client, for a caller that knows Lore would refuse them
   * (`EXCLUDED_SECRET_KEYS`, which Lore's `AppSecretService` answers with a
   * 400): the platform adapter passes it, since a refusal there would fail a
   * deploy over a key the app never meant to send. `lore secrets set --file`
   * does not, so an operator who typed one hears Lore's own refusal.
   */
  public importable(
    vars: Record<string, string>,
    source: string,
    options: { reserved?: ReadonlySet<string> } = {},
  ): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(vars)) {
      if (LoreSecretsService.IMPORT_SKIPPED.has(key)) {
        this.log.info(
          `Kept Lore's ${key}: a copy's own is minted by Lore. Set it one by one to override it.`,
        );
        continue;
      }
      if (options.reserved?.has(key.toUpperCase())) {
        this.log.info(
          `Skipped ${key}: the platform provides it, so Lore does not store it.`,
        );
        continue;
      }
      if (!value) {
        this.log.info(`Skipped ${key}: it has no value in ${source}.`);
        continue;
      }
      pairs.push([key, value]);
    }
    return pairs;
  }

  /**
   * The keys the copy's sealed set holds. Never a value.
   */
  public async keys(target: {
    projectId: number;
    instanceId: string;
  }): Promise<string[]> {
    const { items } = await this.secrets.listAppSecrets({ params: target });
    return items.map((it: { key: string }) => it.key);
  }

  /**
   * Write each pair into the copy's set.
   *
   * One refused key does not stop the others: each refusal is collected with
   * Lore's own sentence, and the caller decides how to fail on them.
   */
  public async push(
    target: { projectId: number; instanceId: string },
    pairs: Array<[string, string]>,
  ): Promise<{ set: string[]; refused: string[] }> {
    const set: string[] = [];
    const refused: string[] = [];
    for (const [key, value] of pairs) {
      try {
        await this.secrets.setAppSecret({
          params: target,
          body: { key, value },
        });
        set.push(key);
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
    return { set, refused };
  }
}
