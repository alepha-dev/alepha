import { $inject } from "alepha";
import { EXCLUDED_SECRET_KEYS } from "alepha/cli/platform-lib";
import { CryptoProvider } from "alepha/crypto";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { type AppSecret, appSecrets } from "../entities/appSecrets.ts";
import { CredentialSealService } from "./CredentialSealService.ts";

/**
 * The one write path for a deployed copy's environment, and the only place
 * that opens one.
 *
 * ## ⚠️ The read path never sees a plaintext
 *
 * {@link list} reads the row and answers {@link AppSecret.valuePrefix}; it does
 * not open anything. {@link open} is the only method that decrypts, it is not
 * reachable from a controller, and its one caller is the deploy. That
 * separation is the whole design: a bug in a list endpoint cannot leak a value
 * it never had.
 *
 * ## ⚠️ Reserved names are refused rather than accepted and overwritten
 *
 * `EXCLUDED_SECRET_KEYS` is the deploy chain's own list, imported rather than
 * copied - the file it lives in says why, and a second copy drifting is the
 * failure it warns about. Folio #1209 is the reason it matters here: the deploy
 * provisions first and derives `DATABASE_URL` and `R2_BUCKET_NAME` from the ids
 * it just got, then regenerates the config. A value stored under one of those
 * names would either be overwritten silently, or worse, win and point a fresh
 * deploy at somebody else's database.
 */
export class AppSecretService {
  protected readonly rows = $repository(appSecrets);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * The label separating this key space from the estate credential's.
   *
   * Declared on {@link CredentialSealService} beside `ESTATE_PURPOSE` rather
   * than written as a literal here, so the two labels are visible in one place
   * and a ciphertext moved between the columns fails to open.
   */
  public static readonly PURPOSE = CredentialSealService.APP_SECRETS_PURPOSE;

  /**
   * How long a value must be before a prefix says less than the value.
   *
   * Four characters of a six-character secret is not a hint. Below this the
   * prefix is empty and the list says only that a value exists.
   */
  public static readonly MIN_MASKABLE_LENGTH = 12;

  /**
   * How many characters the mask keeps.
   */
  public static readonly PREFIX_LENGTH = 4;

  /**
   * ⚠️ Bounded because the whole set is uploaded as `secret_text` bindings in
   * one script upload. Cloudflare's own metadata limit is what an unbounded set
   * would eventually hit, deep inside a deploy, after the assets are up.
   */
  public static readonly MAX_VALUE_LENGTH = 5_000;
  public static readonly MAX_KEYS = 100;

  /**
   * The one variable a deploy mints for itself when the copy has none.
   *
   * ⚠️ **Not reserved.** An operator may still set it, and setting it wins:
   * a copy replacing an existing deployment has to be able to keep the value
   * whose sessions and sealed data are already out there. Generation fills a
   * gap, it does not own the name.
   */
  public static readonly GENERATED_KEY = "APP_SECRET";

  /**
   * Characters of base64url, so 48 bytes of entropy.
   */
  public static readonly GENERATED_LENGTH = 64;

  /**
   * Mint {@link GENERATED_KEY} for a copy that has none, and leave one that
   * has alone.
   *
   * ## ⚠️ Once, and stored - never derived per deploy
   *
   * It is durable state rather than a value the deploy can recompute, which is
   * what separates it from `DATABASE_URL` and `R2_BUCKET_NAME`. Those are
   * derived from ids the provisioning step just returned, and regenerating
   * them is free. Regenerating this one signs out every session and makes
   * anything the app sealed with it unreadable - so the row is written on the
   * first deploy and read on every one after.
   *
   * ## Why a deploy mints it at all
   *
   * Every Alepha app refuses to boot in production without it, and that
   * refusal lands AFTER D1 and R2 are provisioned and the migrations are
   * applied - so an operator who never set one sees a 500 from a deploy that
   * reported success, five layers from the cause. Nobody produces a better
   * value than 48 random bytes, which is the same argument that made the
   * derived names derived.
   */
  public async ensureGenerated(instanceId: string): Promise<void> {
    await this.ensureDefault(
      instanceId,
      AppSecretService.GENERATED_KEY,
      this.crypto.randomText(AppSecretService.GENERATED_LENGTH),
    );
  }

  /**
   * Store `value` under `key` for a copy that has none, and leave one that has
   * alone.
   *
   * A default, never an override: an operator's own value always wins, and
   * the row is written once and read on every deploy after, so a value that is
   * durable state never moves under the copy using it.
   */
  public async ensureDefault(
    instanceId: string,
    key: string,
    value: string,
  ): Promise<void> {
    if (await this.find(instanceId, key)) {
      return;
    }

    try {
      await this.set({
        instanceId,
        key,
        // No `updatedBy`: nobody set it, and naming a person as the author of
        // a value they never chose is worse than an empty column.
        value,
      });
    } catch (error) {
      // ⚠️ Two overlapping deploys of one copy both find nothing and both
      // insert. The unique index on `(instanceId, key)` fails the loser, whose
      // deploy must not die over it: the winner's value is the right one for
      // both, so looking again IS the recovery. Rethrown when the second look
      // finds nothing, because then the failure was not a race.
      if (!(await this.find(instanceId, key))) {
        throw error;
      }
    }
  }

  /**
   * Every name a variable may not take.
   */
  public static reserved(key: string): boolean {
    return EXCLUDED_SECRET_KEYS.has(key.toUpperCase());
  }

  /**
   * What this copy runs with, masked.
   *
   * Ordered by key so the screen is stable between saves rather than ordered by
   * whenever somebody last edited a row.
   */
  public async list(instanceId: string): Promise<AppSecret[]> {
    const rows = await this.rows.findMany({
      where: { instanceId: { eq: instanceId } },
    });
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Set one variable, replacing whatever was there.
   *
   * ⚠️ The plaintext is sealed before it reaches the row and is never written
   * anywhere else - not to a log line, not to an audit record. `key` is
   * normalised to upper case first, because `Database_Url` naming the same
   * thing as `DATABASE_URL` is exactly how a reserved name gets past a list.
   */
  public async set(input: {
    instanceId: string;
    key: string;
    value: string;
    updatedBy?: string;
  }): Promise<AppSecret> {
    const key = this.assertKey(input.key);

    if (!input.value) {
      throw new BadRequestError(
        `${key} has no value. Delete it instead of setting it to nothing: an empty variable and an absent one are different things to an app, and only one of them is what you meant.`,
      );
    }
    if (input.value.length > AppSecretService.MAX_VALUE_LENGTH) {
      throw new BadRequestError(
        `${key} is longer than ${AppSecretService.MAX_VALUE_LENGTH} characters. The whole set goes up as bindings in one script upload, so an unbounded value fails the deploy rather than this request.`,
      );
    }

    const existing = await this.find(input.instanceId, key);
    if (!existing) {
      const count = await this.rows.count({
        instanceId: { eq: input.instanceId },
      });
      if (count >= AppSecretService.MAX_KEYS) {
        throw new BadRequestError(
          `This copy already has ${AppSecretService.MAX_KEYS} variables, which is as many as one deploy carries.`,
        );
      }
    }

    const values = {
      valueSealed: this.seal.seal(input.value, AppSecretService.PURPOSE),
      valuePrefix: this.mask(input.value),
      keyVersion: CredentialSealService.KEY_VERSION,
      updatedBy: input.updatedBy,
    };

    if (existing) {
      return await this.rows.updateById(existing.id, values);
    }
    return await this.rows.create({
      instanceId: input.instanceId,
      key,
      ...values,
    });
  }

  /**
   * Remove one variable.
   *
   * Answers whether there was one, so the caller can 404 rather than report a
   * success for a name that never existed.
   */
  public async remove(instanceId: string, key: string): Promise<boolean> {
    const existing = await this.find(instanceId, key.trim().toUpperCase());
    if (!existing) {
      return false;
    }
    await this.rows.deleteById(existing.id);
    return true;
  }

  /**
   * Whether this copy carries a variable under that name.
   *
   * ⚠️ Deliberately not `open`. The caller wants to know a value EXISTS, and
   * answering that question by decrypting one would put a plaintext on a path
   * that has no business holding it - the separation the rest of this class
   * is built on.
   */
  public async has(instanceId: string, key: string): Promise<boolean> {
    return !!(await this.find(instanceId, key.trim().toUpperCase()));
  }

  /**
   * The set as the app will read it.
   *
   * ⚠️ **The only method that decrypts**, and its only caller is the deploy. It
   * is deliberately not reachable from any controller: a value that never
   * enters a response cannot leave in one.
   *
   * A row that fails to open is a refusal for the whole deploy rather than a
   * gap in the set. `APP_SECRET` rotating without a re-seal is what makes this
   * happen, and shipping a Worker that is missing one variable is worse than
   * not shipping: the app boots, half-configured, and the fault surfaces as
   * whatever that variable was holding together.
   *
   * `except` names what the caller will not deliver, and those rows are
   * skipped BEFORE they are opened rather than dropped after: a value that is
   * never sent has no business being decrypted, and a row that fails to open
   * must not refuse a deploy it would never have reached.
   */
  public async open(
    instanceId: string,
    options: { except?: ReadonlySet<string> } = {},
  ): Promise<Record<string, string>> {
    const rows = await this.list(instanceId);
    const set: Record<string, string> = {};
    for (const row of rows) {
      if (options.except?.has(row.key)) {
        continue;
      }
      try {
        set[row.key] = this.seal.open(
          row.valueSealed,
          AppSecretService.PURPOSE,
        );
      } catch {
        throw new BadRequestError(
          `The stored value for ${row.key} could not be opened, so this deploy would ship without it. That is what a rotated APP_SECRET looks like; set it again to re-seal it.`,
        );
      }
    }
    return set;
  }

  /**
   * One row by name, or nothing.
   */
  protected async find(
    instanceId: string,
    key: string,
  ): Promise<AppSecret | undefined> {
    return await this.rows.findOne({
      where: { instanceId: { eq: instanceId }, key: { eq: key } },
    });
  }

  /**
   * The name, normalised, or a refusal saying why not.
   */
  protected assertKey(raw: string): string {
    const key = raw.trim().toUpperCase();

    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new BadRequestError(
        `"${raw}" is not an environment variable name. Use letters, digits and underscores, starting with a letter.`,
      );
    }
    if (key.length > 100) {
      throw new BadRequestError(`"${raw}" is longer than 100 characters.`);
    }
    if (AppSecretService.reserved(key)) {
      throw new BadRequestError(
        `${key} is set by the deploy, not here. Lore provisions this copy's resources and derives DATABASE_URL, R2_BUCKET_NAME and the CLOUDFLARE_* names from the ids it gets back, so a value stored under one of them would be overwritten - or would win, and point a fresh deploy at somebody else's database.`,
      );
    }
    return key;
  }

  /**
   * What a list says instead of the value.
   */
  protected mask(value: string): string {
    if (value.length < AppSecretService.MIN_MASKABLE_LENGTH) {
      return "";
    }
    return value.slice(0, AppSecretService.PREFIX_LENGTH);
  }
}
