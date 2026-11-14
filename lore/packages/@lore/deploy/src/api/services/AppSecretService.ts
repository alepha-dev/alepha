import { sigilConfig } from "@alepha/lore/sigil";
import { $inject } from "alepha";
import {
  BAY_OWNED_SECRET_KEYS,
  EXCLUDED_SECRET_KEYS,
} from "alepha/cli/infra-lib";
import { CryptoProvider } from "alepha/crypto";
import { $repository, DatabaseUrlParser } from "alepha/orm";
import { BadRequestError, ValidationError } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { type AppSecret, appSecrets } from "../entities/appSecrets.ts";
import { artifacts } from "../entities/artifacts.ts";
import { deployments } from "../entities/deployments.ts";
import { hosts } from "../entities/hosts.ts";
import type { DeclaredEnvKey } from "../schemas/declaredEnvKeySchema.ts";
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
  protected readonly instances = $repository(appInstances);
  protected readonly hosts = $repository(hosts);
  protected readonly artifacts = $repository(artifacts);
  protected readonly deployments = $repository(deployments);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * The label separating this key space from the host credential's.
   *
   * Declared on {@link CredentialSealService} beside `HOST_PURPOSE` rather
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
   * Every name this copy refuses, for a client to flag before it sends: the
   * names the deploy derives, plus Bay's own when the copy deploys to a Bay
   * host. The server still refuses them itself; this is the preview.
   */
  public async reservedKeys(instanceId: string): Promise<string[]> {
    const bay = await this.bayCopy(instanceId);
    return [
      ...new Set([
        // DATABASE_URL is settable on a Cloudflare copy, to a Postgres URL
        // (#Q3509); a Bay copy refuses it as one of Bay's own names below.
        ...[...EXCLUDED_SECRET_KEYS].filter(
          (key) => key !== AppSecretService.DATABASE_URL_KEY,
        ),
        ...(bay ? BAY_OWNED_SECRET_KEYS : []),
      ]),
    ].sort();
  }

  /**
   * Whether this copy runs on a Bay: one deploying to a Bay host, or a
   * stack's app service, whose host is its stack environment's (only a Bay
   * runs stacks) and which carries none of its own. The slug names the
   * host when the copy has one, for the refusal to name it.
   */
  protected async bayCopy(
    instanceId: string,
  ): Promise<{ host?: string } | undefined> {
    const instance = await this.instances.findById(instanceId);
    if (!instance) {
      return undefined;
    }
    if (instance.stackEnvironmentId) {
      return {};
    }
    const host = instance.hostId
      ? await this.hosts.findById(instance.hostId)
      : undefined;
    return host?.type === "bay" ? { host: host.slug } : undefined;
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
    /**
     * The declared variable names, when the caller already read them: a bulk
     * import reads the manifest once rather than once per key.
     */
    variables?: ReadonlySet<string>;
    /**
     * Where `key` sits in the caller's request body (`"/key"`). Given, a
     * refused name is a `ValidationError` naming that field, which a form
     * built from the action shows under it; without it, a `BadRequestError`.
     */
    keyPath?: string;
  }): Promise<AppSecret> {
    const key = this.assertKey(input.key, input.keyPath);
    await this.assertDeliverable(input.instanceId, key);
    this.assertValue(key, input.value);
    await this.assertDatabaseUnshared(input.instanceId, key, input.value);

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

    // A variable follows the app's declaration, never the caller (#Q2467):
    // a key the manifest lists under `variables` keeps a readable copy, and
    // anything else - undeclared included - is sealed only.
    const variables =
      input.variables ??
      new Set(
        (await this.declared(input.instanceId))
          .filter((declared) => declared.kind === "variable")
          .map((declared) => declared.name),
      );
    // `SIGIL_CONFIG` is a variable whatever the manifest says (#Q3103): the
    // reporting module declares it `secret: false` itself, so this is the
    // same declaration read from `@alepha/lore` rather than from a build, and
    // a copy with no deployed build yet keeps a value its Sigil switches can
    // read back.
    const variable =
      variables.has(key) || key === AppSecretService.SIGIL_CONFIG_KEY;

    const values = {
      label: this.labelOf(key, input.value) ?? null,
      valueSealed: await this.seal.seal(input.value, AppSecretService.PURPOSE),
      // Sealed only, and the readable copy cleared, when it is a secret: a key
      // that stopped being a variable must not keep its plaintext.
      value: variable ? input.value : null,
      valuePrefix: variable ? "" : this.mask(input.value),
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
      label: values.label ?? undefined,
      value: variable ? input.value : undefined,
    });
  }

  /**
   * Set several variables in one request, all or nothing (#Q2468).
   *
   * Every name and value is checked before anything is written, so a refused
   * line leaves the set as it was rather than half-imported. D1 has no
   * transactions, so "all or nothing" is enforced by validating first; a
   * storage failure midway is the one case that can still leave part of it.
   */
  public async setMany(input: {
    instanceId: string;
    entries: Array<{ key: string; value: string }>;
    updatedBy?: string;
  }): Promise<AppSecret[]> {
    const entries = new Map<string, string>();
    for (const entry of input.entries) {
      const key = this.assertKey(entry.key);
      await this.assertDeliverable(input.instanceId, key);
      this.assertValue(key, entry.value);
      await this.assertDatabaseUnshared(input.instanceId, key, entry.value);
      entries.set(key, entry.value);
    }

    const existing = new Set(
      (await this.list(input.instanceId)).map((row) => row.key),
    );
    const added = [...entries.keys()].filter((key) => !existing.has(key));
    if (existing.size + added.length > AppSecretService.MAX_KEYS) {
      throw new BadRequestError(
        `This import would bring the copy to ${existing.size + added.length} variables, and one deploy carries at most ${AppSecretService.MAX_KEYS}.`,
      );
    }

    const variables = new Set(
      (await this.declared(input.instanceId))
        .filter((declared) => declared.kind === "variable")
        .map((declared) => declared.name),
    );
    const rows: AppSecret[] = [];
    for (const [key, value] of entries) {
      rows.push(
        await this.set({
          instanceId: input.instanceId,
          key,
          value,
          updatedBy: input.updatedBy,
          variables,
        }),
      );
    }
    return rows;
  }

  /**
   * Every environment variable this copy's app declares, from the manifest of
   * the build it last deployed, else of the app's newest archive (#Q2467).
   *
   * Empty when neither exists or the stored manifest cannot be read: absence
   * is "unknown", and an unknown key is a secret, which is the direction that
   * fails safe.
   */
  public async declared(instanceId: string): Promise<DeclaredEnvKey[]> {
    const instance = await this.instances.findById(instanceId);
    if (!instance) {
      return [];
    }

    const [lastDeploy] = await this.deployments.findMany({
      where: {
        instanceId: { eq: instanceId },
        status: { eq: "succeeded" },
      },
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: 1,
    });
    let manifest = lastDeploy?.artifactId
      ? (await this.artifacts.findById(lastDeploy.artifactId))?.manifest
      : undefined;
    if (!manifest) {
      const [newest] = await this.artifacts.findMany({
        where: {
          projectId: { eq: instance.projectId },
          app: { eq: instance.app },
          format: { eq: "archive" },
        },
        orderBy: [{ column: "updatedAt", direction: "desc" }],
        limit: 1,
      });
      manifest = newest?.manifest;
    }
    if (!manifest) {
      return [];
    }

    try {
      const parsed = JSON.parse(manifest) as {
        secrets?: Array<{ name?: unknown; description?: unknown }>;
        variables?: Array<{ name?: unknown; description?: unknown }>;
      };
      const of = (
        list: typeof parsed.secrets,
        kind: DeclaredEnvKey["kind"],
      ): DeclaredEnvKey[] =>
        (Array.isArray(list) ? list : [])
          .filter((entry) => typeof entry?.name === "string")
          .map((entry) => ({
            name: String(entry.name),
            description:
              typeof entry.description === "string"
                ? entry.description
                : undefined,
            kind,
          }));
      return [
        ...of(parsed.secrets, "secret"),
        ...of(parsed.variables, "variable"),
      ]
        .filter((entry) => !AppSecretService.reserved(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
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
        set[row.key] = await this.seal.open(
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
   * The copy's {@link GENERATED_KEY}, opened, or undefined when it has none.
   *
   * ⚠️ **The second method that decrypts**, beside {@link open}, and like it
   * reachable from no controller a person calls. Its one caller is the
   * app-secret pull, which a Bay machine deploying this copy reads: the hash
   * on every deploy, the value only for an instance that has no key. A row
   * that fails to open is a refusal, never "none": a machine told "none"
   * would mint a key and escrow it over this row.
   */
  public async openGenerated(instanceId: string): Promise<string | undefined> {
    const row = await this.find(instanceId, AppSecretService.GENERATED_KEY);
    if (!row) {
      return undefined;
    }
    try {
      return await this.seal.open(row.valueSealed, AppSecretService.PURPOSE);
    } catch {
      throw new BadRequestError(
        `The stored ${AppSecretService.GENERATED_KEY} of this copy could not be opened, so Lore cannot say which key it holds.`,
      );
    }
  }

  /**
   * Store the key a Bay machine runs this copy on, as its
   * {@link GENERATED_KEY} row, sealed only.
   *
   * ⚠️ **The one caller allowed to write a Bay copy's key**, the escrow route
   * a machine calls inside its own `deploy` command, which is why it does
   * not pass `assertDeliverable`. Unlike {@link set} it never keeps a readable
   * copy, whatever the build's manifest declares, and it leaves `updatedBy`
   * empty: nobody typed it, the machine runs it.
   *
   * Answers whether it wrote, and whether it replaced a different key, which
   * the caller says on the deploy's log: the value replaced is gone for good.
   */
  public async escrow(
    instanceId: string,
    value: string,
  ): Promise<{ stored: boolean; replaced: boolean }> {
    if (!value || /\s/.test(value)) {
      throw new BadRequestError(
        `The ${AppSecretService.GENERATED_KEY} a machine escrows is not empty and holds no whitespace.`,
      );
    }
    if (value.length > AppSecretService.MAX_VALUE_LENGTH) {
      throw new BadRequestError(
        `The ${AppSecretService.GENERATED_KEY} a machine escrows is at most ${AppSecretService.MAX_VALUE_LENGTH} characters.`,
      );
    }
    const values = {
      valueSealed: await this.seal.seal(value, AppSecretService.PURPOSE),
      value: null,
      valuePrefix: this.mask(value),
      keyVersion: CredentialSealService.KEY_VERSION,
      updatedBy: null,
    };
    const existing = await this.find(
      instanceId,
      AppSecretService.GENERATED_KEY,
    );
    if (!existing) {
      await this.rows.create({
        instanceId,
        key: AppSecretService.GENERATED_KEY,
        valueSealed: values.valueSealed,
        valuePrefix: values.valuePrefix,
        keyVersion: values.keyVersion,
      });
      return { stored: true, replaced: false };
    }
    let held: string | undefined;
    try {
      held = await this.seal.open(
        existing.valueSealed,
        AppSecretService.PURPOSE,
      );
    } catch {
      // A row that no longer opens holds no key anyone can use: the
      // machine's replaces it, and that is a replacement worth saying.
      held = undefined;
    }
    if (held === value && existing.value == null && !existing.updatedBy) {
      return { stored: false, replaced: false };
    }
    await this.rows.updateById(existing.id, values as any);
    return { stored: true, replaced: held !== value };
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
  protected assertKey(raw: string, path?: string): string {
    const key = raw.trim().toUpperCase();
    const refuse = (message: string) =>
      path
        ? new ValidationError(
            { part: "body", issues: [{ path, message }] },
            { message },
          )
        : new BadRequestError(message);

    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw refuse(
        `"${raw}" is not an environment variable name. Use letters, digits and underscores, starting with a letter.`,
      );
    }
    if (key.length > 100) {
      throw refuse(`"${raw}" is longer than 100 characters.`);
    }
    // The one reserved name a copy may set (#Q3509): a Postgres URL, which
    // moves the copy onto Hyperdrive. Special-cased here and nowhere else:
    // `EXCLUDED_SECRET_KEYS` is the CLI's list too, and dropping the name
    // there would push a laptop's DATABASE_URL as a Worker secret. The value
    // never becomes one either: the deploy strips it from the upload and
    // hands it to provisioning and migrations only.
    // Its value is checked in `assertValue`, after a Bay copy has refused
    // the name outright.
    if (key === AppSecretService.DATABASE_URL_KEY) {
      return key;
    }
    if (AppSecretService.reserved(key)) {
      throw refuse(
        `${key} is set by the deploy, not here. Lore provisions this copy's resources and derives DATABASE_URL, R2_BUCKET_NAME and the CLOUDFLARE_* names from the ids it gets back, so a value stored under one of them would be overwritten - or would win, and point a fresh deploy at somebody else's database.`,
      );
    }
    return key;
  }

  /**
   * That the host this copy deploys to will deliver a variable by that name.
   *
   * ⚠️ Bay writes its own names (`BAY_OWNED_SECRET_KEYS`) into every instance
   * itself, and the secret pull leaves them out, so a value stored under one
   * for a copy on a Bay host would sit on this tab and never reach the app.
   * Refused while the operator is still holding the request. Everywhere else
   * APP_SECRET and APP_NAME stay settable, on purpose: see
   * {@link AppSecretService.GENERATED_KEY}.
   *
   * Asked of the host the copy deploys to NOW. A copy moved onto a Bay
   * host afterwards keeps the rows it had, which is why the pull filters
   * as well.
   */
  protected async assertDeliverable(
    instanceId: string,
    key: string,
  ): Promise<void> {
    if (!BAY_OWNED_SECRET_KEYS.has(key)) {
      return;
    }
    const bay = await this.bayCopy(instanceId);
    if (!bay) {
      return;
    }
    const where = bay.host
      ? `This copy deploys to the Bay host '${bay.host}'`
      : "This copy is a stack's app service, which runs on a Bay";
    if (key === AppSecretService.GENERATED_KEY) {
      // ⚠️ Not "never reaches the app" any more: Lore holds the machine's
      // key, escrowed by Bay, and hands it to a rebuilt host. A value typed
      // here would become that host's key, silently.
      throw new BadRequestError(
        `${key} is set by Bay, not here. ${where}: Bay mints the key and Lore holds the one the machine runs on, so a rebuilt host gets it back. A value typed here would become the key of the next rebuilt host. To change it, run \`bay secret replace\` on the machine.`,
      );
    }
    throw new BadRequestError(
      `${key} is set by Bay, not here. ${where}, which writes ${key} into every instance itself, so a value stored here would never reach the app.`,
    );
  }

  /**
   * That a value can be stored, or a refusal saying why not.
   */
  protected assertValue(key: string, value: string): void {
    if (!value) {
      throw new BadRequestError(
        `${key} has no value. Delete it instead of setting it to nothing: an empty variable and an absent one are different things to an app, and only one of them is what you meant.`,
      );
    }
    if (value.length > AppSecretService.MAX_VALUE_LENGTH) {
      throw new BadRequestError(
        `${key} is longer than ${AppSecretService.MAX_VALUE_LENGTH} characters. The whole set goes up as bindings in one script upload, so an unbounded value fails the deploy rather than this request.`,
      );
    }
    if (key === AppSecretService.SIGIL_CONFIG_KEY) {
      this.assertSigilConfig(value);
    }
    if (key === AppSecretService.DATABASE_URL_KEY && !this.postgresUrl(value)) {
      throw new BadRequestError(
        "DATABASE_URL takes a Postgres URL only (postgres:// or postgresql://), which moves this copy onto Postgres through Hyperdrive. Leave it unset for D1: Lore provisions the D1 database and derives the URL itself.",
      );
    }
  }

  /**
   * What a value points at, for {@link appSecrets.label}: `host:port/database`
   * for a Postgres `DATABASE_URL`, nothing for anything else.
   */
  protected labelOf(key: string, value: string): string | undefined {
    if (key !== AppSecretService.DATABASE_URL_KEY) {
      return undefined;
    }
    const url = this.postgresUrl(value);
    return url
      ? `${url.hostname}:${url.port || "5432"}/${decodeURIComponent(url.pathname.replace(/^\//, ""))}`
      : undefined;
  }

  /**
   * The database this copy runs on, as its Environment tab shows it: D1, or
   * the Postgres server its `DATABASE_URL` names. Undefined on a Bay copy,
   * whose database is Bay's own.
   */
  public async databaseOf(
    instanceId: string,
  ): Promise<{ kind: "d1" | "postgres"; place?: string } | undefined> {
    if (await this.bayCopy(instanceId)) {
      return undefined;
    }
    const row = await this.find(instanceId, AppSecretService.DATABASE_URL_KEY);
    return row ? { kind: "postgres", place: row.label } : { kind: "d1" };
  }

  /**
   * The reserved name a copy may set to a Postgres URL (#Q3509).
   */
  public static readonly DATABASE_URL_KEY = "DATABASE_URL";

  /**
   * The parsed URL when `value` names a Postgres server, else undefined. An
   * unparsable value is undefined too: it is refused as "not Postgres".
   */
  protected postgresUrl(value: string): URL | undefined {
    try {
      if (!new DatabaseUrlParser().isPostgres(value)) {
        return undefined;
      }
      return new URL(value);
    } catch {
      return undefined;
    }
  }

  /**
   * That no other copy already holds a `DATABASE_URL` naming the same host,
   * port and database (#Q3509).
   *
   * `POSTGRES_SCHEMA` stays reserved, so every copy migrates the `public`
   * schema and shares one journal, `drizzle.migrations_public`: two copies on
   * one database would apply each other's migrations into one set of tables.
   * Refused rather than documented, since the failure would be silent.
   *
   * ⚠️ Opens the other copies' sealed URLs to compare them, server side and
   * nowhere else; neither value is returned or logged.
   */
  protected async assertDatabaseUnshared(
    instanceId: string,
    key: string,
    value: string,
  ): Promise<void> {
    if (key !== AppSecretService.DATABASE_URL_KEY) {
      return;
    }
    const target = this.postgresUrl(value);
    if (!target) {
      return;
    }
    const place = (url: URL) =>
      `${url.hostname.toLowerCase()}:${url.port || "5432"}/${decodeURIComponent(url.pathname.replace(/^\//, ""))}`;
    const rows = await this.rows.findMany({
      where: { key: { eq: AppSecretService.DATABASE_URL_KEY } },
    });
    for (const row of rows) {
      if (row.instanceId === instanceId) {
        continue;
      }
      let other: URL | undefined;
      try {
        other = this.postgresUrl(
          await this.seal.open(row.valueSealed, AppSecretService.PURPOSE),
        );
      } catch {
        continue;
      }
      if (other && place(other) === place(target)) {
        const instance = await this.instances.findById(row.instanceId);
        throw new BadRequestError(
          `Another copy${instance ? ` (${instance.env})` : ""} already runs on ${place(target)}. Two copies on one database would share one migrations journal and one set of tables; give this one a database of its own.`,
        );
      }
    }
  }

  /**
   * The variable the Sigil features form writes (#Q3103).
   */
  public static readonly SIGIL_CONFIG_KEY = "SIGIL_CONFIG";

  /**
   * That `SIGIL_CONFIG` is a value the reporting module will accept.
   *
   * ⚠️ Checked here rather than left to the app because the app's answer
   * comes too late: its `$env` parse refuses a malformed value at boot, so a
   * typo saved on this tab deploys "successfully" and then answers 500, with
   * the cause five layers away. Unknown fields pass, the way the app's own
   * parse lets them through, so a copy running a newer `@alepha/lore` than
   * this Lore can still be given its newer switches.
   */
  protected assertSigilConfig(value: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestError(
        `SIGIL_CONFIG is not JSON. It is one object of switches, such as {"vitals":false}.`,
      );
    }
    const result = sigilConfig.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
      throw new BadRequestError(
        `SIGIL_CONFIG would be refused by the app when it boots${where}: ${issue?.message ?? "invalid value"}.`,
      );
    }
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
