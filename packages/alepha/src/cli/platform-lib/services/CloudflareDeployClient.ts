import { AlephaError } from "alepha";
import { Queues } from "cloudflare/resources/queues";
import { Workers } from "cloudflare/resources/workers";
import { createClient } from "cloudflare/tree-shakable";

import {
  type CloudflareAssetEntry,
  CloudflareAssetManifest,
} from "./CloudflareAssetManifest.ts";

/**
 * Everything one Worker deploy needs, already resolved.
 *
 * ⚠️ **The bindings are REGENERATED, never read from the artifact's own
 * `wrangler.jsonc`.** Folio #1209: a packed config carries no `d1_databases`,
 * no `r2_buckets` and no `vars`, deliberately, because a build must not freeze
 * a production database id into stored bytes. Uploading the packed config is
 * the one implementation that looks right and is not - it produces a Worker
 * with no database, which fails at start rather than at deploy.
 */
export interface CloudflareDeployPlan {
  /**
   * The Worker's name. `NamingService` derives it as `<project>-<env>`.
   */
  scriptName: string;

  /**
   * The entry module's filename, which must appear in {@link modules}.
   */
  mainModule: string;

  /**
   * The script and everything it imports. With `no_bundle` this is a glob
   * result, not an import-graph walk: the generated config sets
   * `rules: [{ type: "ESModule", globs: ["index.js", "server/*.js"] }]`.
   */
  modules: Array<{ name: string; bytes: Uint8Array; type?: string }>;

  compatibilityDate?: string;
  compatibilityFlags?: string[];

  /**
   * Everything the Worker binds, as the API's own binding objects.
   */
  bindings?: Array<Record<string, unknown>>;

  /**
   * #1813's sealed set, opened. Sent as `secret_text` bindings in THIS upload:
   * there is no second upload path and no `wrangler secret put` ordering to
   * reproduce, so the roughly 6 s window in which a new build ran against the
   * previous secret set does not exist here.
   */
  secrets?: Record<string, string>;

  migrations?: Record<string, unknown>;
  observability?: Record<string, unknown>;
  placement?: Record<string, unknown>;
  limits?: Record<string, unknown>;

  /**
   * Cron expressions. An empty array CLEARS the Worker's triggers, which is
   * why it is distinct from `undefined`: a deploy that stopped declaring a
   * cron must stop firing it.
   */
  crons?: string[];

  /**
   * A custom domain to attach, account-level.
   */
  domain?: { hostname: string; zoneId?: string; zoneName?: string };

  /**
   * Whether the Worker answers on `<name>.<subdomain>.workers.dev`.
   */
  workersDev?: boolean;

  /**
   * The queues this Worker consumes, by id, each with the API's own consumer
   * settings. A dead-letter queue is named, not id'd: that is what the API
   * takes.
   */
  queueConsumers?: Array<{
    queueId: string;
    settings?: CloudflareQueueConsumerSettings;
    deadLetterQueue?: string;
  }>;

  assets?: CloudflareDeployAssets;
}

/**
 * A Worker consumer's settings, in the API's vocabulary rather than
 * wrangler's.
 *
 * ⚠️ The two differ, and not only in spelling: wrangler's `max_batch_size` is
 * `batch_size` here, and its `max_batch_timeout` is in SECONDS where
 * `max_wait_time_ms` is in milliseconds.
 */
export interface CloudflareQueueConsumerSettings {
  batch_size?: number;
  max_retries?: number;
  max_wait_time_ms?: number;
  max_concurrency?: number;
  retry_delay?: number;
}

export interface CloudflareDeployAssets {
  manifest: Record<string, CloudflareAssetEntry>;
  /**
   * The bytes of one asset, by the manifest key.
   *
   * A callback rather than a map, because the whole point of batching is never
   * to hold the asset set: `apps/docs` is 1545 files and 44 MB against a
   * 128 MB isolate.
   */
  read: (key: string) => Promise<Uint8Array>;

  /**
   * Every wanted asset, pushed rather than pulled, so the caller decides how
   * the bytes are produced and never has to hold them all.
   *
   * ## ⚠️ Why a second reading shape exists
   *
   * {@link read} is a PULL, and a pull needs the bytes to be addressable one
   * key at a time - which means they are sitting somewhere. For a deploy
   * running inside Lore's Worker that somewhere was a `MemoryFileSystemProvider`
   * holding the whole unpacked tree, and `apps/docs` is 49 MB of assets inside
   * a 128 MB isolate. It died with `Worker exceeded memory limit` before the
   * upload began.
   *
   * A push lets the source be a single walk of the archive: each file exists
   * for the length of one call, joins the batch being filled, and is gone. The
   * memory is one batch, whatever the site's size.
   *
   * ⚠️ **`bytes` is valid only until the callback resolves.** The caller is
   * free to hand out a view into a buffer it is about to move past.
   *
   * Optional, because a deploy from a laptop has the files on a disk and
   * {@link read} is the simpler thing there.
   */
  readAll?: (
    keys: Set<string>,
    onFile: (key: string, bytes: Uint8Array) => Promise<void>,
  ) => Promise<void>;

  config?: Record<string, unknown>;
}

/**
 * Deploying a Worker with no `wrangler` process.
 *
 * ## ⚠️ Credentials are constructor arguments. Nothing here reads the environment
 *
 * `CloudflareApi` in this same directory cannot be this class, and the reason
 * is a security one rather than a layering one. It injects `WranglerApi`, which
 * injects `ShellProvider`, so it never enters a Worker bundle; and its
 * `resolveAccountId` falls back to `process.env.CLOUDFLARE_ACCOUNT_ID`, which
 * inside Lore's Worker is **Lore's own account**, set for Analytics Engine. A
 * client that read its credential from the environment would deploy a user's
 * artifact into the operator's Cloudflare account.
 *
 * So the token and the account id come in from the estate row, at the moment of
 * use, and this file imports neither `CloudflareApi` nor anything that reads
 * `process.env`. `workerdEntryGraph.spec.ts` is what keeps that true.
 *
 * ## Seven calls, not one
 *
 * `wrangler deploy` does more than upload a script, and the last four are the
 * ones a naive implementation drops silently - crons stop firing, the custom
 * domain never attaches, the queue consumer never binds.
 *
 * 1. an upload session for the asset manifest
 * 2. one call per batch of assets, answering a completion jwt
 * 3. the script itself, with its bindings and the assets jwt
 * 4. cron triggers
 * 5. the custom domain
 * 6. the workers.dev subdomain
 * 7. queue consumers
 *
 * An eighth, `getSubdomain`, sits outside this sequence: it is the caller's
 * read of the account's subdomain to compose the address a domainless deploy
 * answers on, and it happens after the deploy rather than as part of it.
 *
 * ⚠️ Step 6 has **no save-time permission probe standing behind it**. The
 * workers.dev probe was dropped from #1630 because
 * `GET /accounts/{id}/workers/subdomain` answers error `10007` for an account
 * that never registered one, which a probe would misread as a missing
 * permission and use to refuse a valid token. "This account has no workers.dev
 * subdomain" is therefore a deploy-time fact, and since step 6 now runs on
 * every deploy it is REPORTED rather than thrown: by then the script is live,
 * and a Worker that is serving must not be recorded as a failed deploy over
 * the host it is additionally reachable at.
 *
 * ⚠️ Step 5 is `workers.domains.update` and never `workers.routes.create`. The
 * first is account-level and covered by the `workers` probe; the second is
 * zone-scoped and would need a probe no estate can run for a zone it does not
 * know. Wildcard hosts went away with the owner's 2026-09-06 ruling, so a Lore
 * deploy never emits a route.
 */
export class CloudflareDeployClient {
  /**
   * How much base64 to put in one asset upload request.
   *
   * ⚠️ Deliberately smaller than the server's suggested buckets, and the
   * ceiling being respected is MEMORY rather than time. wrangler's own bucket
   * cap is 98 MB, which does not fit a 128 MB isolate that is also holding the
   * script. Paid Workers get 10,000 subrequests per invocation, so trading
   * requests for memory is the right way round.
   */
  protected static readonly BATCH_BYTES = 3 * 1024 * 1024;

  /**
   * A hard cap beside the byte budget, so a directory of thousands of tiny
   * files does not compose one enormous JSON body.
   */
  protected static readonly BATCH_FILES = 200;

  /**
   * How many batches may be in flight, and how often one is retried.
   *
   * Both are wrangler's numbers (`BULK_UPLOAD_CONCURRENCY`,
   * `MAX_UPLOAD_ATTEMPTS`), and taking them rather than inventing our own is
   * the point: it has been uploading assets against this API for years, and a
   * number chosen here would be a guess dressed as a decision.
   */
  protected static readonly UPLOAD_CONCURRENCY = 3;
  protected static readonly MAX_UPLOAD_ATTEMPTS = 5;

  protected readonly manifest = new CloudflareAssetManifest();
  protected readonly accountId: string;
  protected readonly client: CloudflareDeployApi;

  /**
   * The clock the session deadline is read against.
   *
   * ⚠️ Supplied rather than taken from the platform, because this class is
   * built with `new` per deploy and has no container to inject one from. A
   * caller that supplies none gets no deadline check: an absent clock must
   * cost a diagnostic, never a wrong answer about whether a token is still
   * valid.
   */
  protected readonly now?: () => number;

  constructor(options: {
    apiToken: string;
    accountId: string;
    /**
     * A pre-built client, which is how a test drives this without a network.
     * Production passes neither.
     */
    client?: CloudflareDeployApi;
    baseURL?: string;
    now?: () => number;
  }) {
    if (!options.apiToken) {
      throw new AlephaError(
        "A Cloudflare deploy needs an API token from the estate. Nothing here falls back to the environment: that would deploy into the operator's own account.",
      );
    }
    if (!options.accountId) {
      throw new AlephaError(
        "A Cloudflare deploy needs the estate's account id. Nothing here falls back to the environment.",
      );
    }
    this.accountId = options.accountId;
    this.now = options.now;
    this.client =
      options.client ??
      (createClient({
        apiToken: options.apiToken,
        baseURL: options.baseURL,
        // D1 is not here: this client deploys, and `D1MigrationsService` owns
        // the migration transport. Every resource added is bundle weight in
        // Lore's Worker.
        resources: [Workers, Queues],
      }) as unknown as CloudflareDeployApi);
  }

  /**
   * The whole deploy, in order.
   */
  public async deploy(
    plan: CloudflareDeployPlan,
  ): Promise<{ versionId?: string; subdomainError?: string }> {
    const assets = plan.assets
      ? await this.uploadAssets(plan.scriptName, plan.assets)
      : undefined;

    const versionId = await this.putScript(plan, assets);
    await this.putSchedules(plan);
    await this.putDomain(plan);
    // Reported, not thrown: see `putSubdomain`. The caller decides what to
    // say about it, because only the caller knows whether the app had a
    // custom domain to fall back on.
    const subdomainError = await this.putSubdomain(plan);
    await this.putQueueConsumers(plan);

    return { versionId, subdomainError };
  }

  /**
   * Open a session for the manifest, upload what Cloudflare asks for, and
   * answer the completion jwt.
   *
   * ⚠️ **`undefined` back means the asset set is unchanged**, which is the
   * `keep_assets` case rather than a failure: Cloudflare answers a session with
   * no buckets when it already holds every hash, so a redeploy or a rollback
   * uploads zero files.
   */
  public async uploadAssets(
    scriptName: string,
    assets: CloudflareDeployAssets,
  ): Promise<{ jwt: string } | undefined> {
    const session = await this.client.workers.scripts.assets.upload.create(
      scriptName,
      { account_id: this.accountId, manifest: assets.manifest },
    );

    const buckets = session.buckets ?? [];
    const wanted = buckets.flat();
    if (wanted.length === 0) {
      return session.jwt ? { jwt: session.jwt } : undefined;
    }

    // ⚠️ Refused rather than attempted. A session in this mode wants one
    // request per file against `/workers/assets/upload/{hash}`, with the raw
    // bytes as the body and the type as a request header - a different
    // transport, not a different batch size. Sending it multipart anyway is
    // the shape of failure this whole file has been paying for: something the
    // API does not accept, failing in a way that names nothing.
    const { expiresAt, singleAsset } = this.session(session.jwt);
    if (singleAsset) {
      throw new AlephaError(
        "Cloudflare asked for single-asset uploads for this session, which this client does not implement. Deploy this app with `alepha platform up`, which shells out to wrangler and does.",
      );
    }

    // The manifest is keyed by served path and the buckets by hash, so the
    // upload needs the inverse. Built once rather than searched per file.
    const byHash = new Map<string, string>();
    for (const [key, entry] of Object.entries(assets.manifest)) {
      byHash.set(entry.hash, key);
    }

    let completion = session.jwt;

    // ⚠️ The streaming path, when the caller can push. It uploads a batch the
    // moment that batch is full rather than reading files one at a time, so
    // the bytes resident at any point are one batch instead of a site. See
    // `CloudflareDeployAssets.readAll`.
    //
    // ⚠️ **This path cannot honour the server's bucketing, and the pull path
    // above does.** A push arrives in the order the source can produce - for
    // a deploy that is the order of the archive - while a bucket is an
    // arbitrary set of hashes. Holding files back until their bucket is
    // complete would mean holding most of the site, which is the memory this
    // path exists to avoid. So the grouping is ours here and the server's
    // there, and that asymmetry is deliberate.
    if (assets.readAll) {
      let body: Record<string, File> = {};
      let bytes = 0;
      // ⚠️ Up to `UPLOAD_CONCURRENCY` batches are in flight at once, which is
      // what stops a site of a thousand files being a thousand round trips
      // end to end. The completion token is whichever answer carries one, in
      // whatever order they land - the same rule wrangler applies.
      const inFlight = new Set<Promise<unknown>>();
      const send = (batch: Record<string, File>) => {
        const pending = this.postAssetsWithRetry(batch, completion, expiresAt)
          .then((answer) => {
            completion = answer.jwt ?? completion;
            return answer;
          })
          .finally(() => inFlight.delete(pending));
        inFlight.add(pending);
      };
      const flush = async () => {
        if (bytes === 0) return;
        send(body);
        body = {};
        bytes = 0;
        if (inFlight.size >= CloudflareDeployClient.UPLOAD_CONCURRENCY) {
          await Promise.race(inFlight);
        }
      };

      const keys = new Set<string>();
      for (const hash of wanted) {
        const key = byHash.get(hash);
        if (!key) {
          throw new AlephaError(
            `Cloudflare asked for an asset hash (${hash}) that is not in the manifest we sent. Refusing to guess which file it meant.`,
          );
        }
        keys.add(key);
      }

      await assets.readAll(keys, async (key, raw) => {
        const hash = assets.manifest[key]?.hash;
        if (!hash) return;
        const encoded = this.manifest.base64(raw);
        body[hash] = new File([encoded], hash, {
          type: this.manifest.contentType(key),
        });
        bytes += encoded.length;
        if (
          bytes >= CloudflareDeployClient.BATCH_BYTES ||
          Object.keys(body).length >= CloudflareDeployClient.BATCH_FILES
        ) {
          await flush();
        }
      });
      await flush();
      await Promise.all(inFlight);

      if (!completion) {
        throw new AlephaError(
          "Cloudflare accepted every asset upload but returned no completion token, so the script upload has nothing to reference.",
        );
      }
      return { jwt: completion };
    }

    for (const batch of this.batches(buckets, assets.manifest, byHash)) {
      const body: Record<string, File> = {};
      for (const hash of batch) {
        const key = byHash.get(hash);
        if (!key) {
          throw new AlephaError(
            `Cloudflare asked for an asset hash (${hash}) that is not in the manifest we sent. Refusing to guess which file it meant.`,
          );
        }
        // ⚠️ **A `File`, never the base64 string it holds.** Cloudflare stores
        // each part's `Content-Type` as the one it will serve the asset with,
        // and the SDK writes a part's type only for a `Blob`: a plain string
        // is appended with none, so every asset comes back with an EMPTY
        // content type. The browser then refuses each module script and each
        // stylesheet under strict MIME checking - and a prerendered site still
        // paints, so the deploy looks like it worked.
        body[hash] = new File(
          [this.manifest.base64(await assets.read(key))],
          hash,
          { type: this.manifest.contentType(key) },
        );
      }

      const answer = await this.postAssetsWithRetry(
        body,
        completion,
        expiresAt,
      );
      // Only the LAST response carries the completion token; the others answer
      // an empty result, so keeping the newest non-empty one is the rule.
      completion = answer.jwt ?? completion;
    }

    if (!completion) {
      throw new AlephaError(
        "Cloudflare accepted every asset upload but returned no completion token, so the script upload has nothing to reference.",
      );
    }
    return { jwt: completion };
  }

  /**
   * What the session's own token says about the session.
   *
   * ⚠️ **The upload token is a real JWT and it carries instructions**, which
   * is not obvious and is not documented: `exp` is a hard deadline on the
   * whole upload, and `wrangler_single_asset_uploads` asks for a completely
   * different transport. wrangler reads both. Reading neither is how an
   * upload stops mid-way with nothing to say for itself.
   */
  protected session(jwt: string | undefined): {
    expiresAt?: number;
    singleAsset: boolean;
  } {
    if (!jwt) {
      return { singleAsset: false };
    }
    try {
      const part = jwt.split(".")[1] ?? "";
      const padded = part.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(
        atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
      );
      return {
        expiresAt:
          typeof payload.exp === "number" ? payload.exp * 1000 : undefined,
        singleAsset: payload.wrangler_single_asset_uploads === true,
      };
    } catch {
      // A token this cannot read is still a token the API may accept, so this
      // is not a refusal: it only costs the deadline and the mode.
      return { singleAsset: false };
    }
  }

  /**
   * One batch of assets, retried the way wrangler retries.
   *
   * ⚠️ **The expiry is checked BEFORE each attempt, not after a failure.**
   * Uploads already accepted are kept by Cloudflare, so a run that ends here
   * has not wasted them - the next deploy asks for a fresh session and is
   * handed back only what is still missing. Saying that in the message is the
   * difference between "start again" and "run it again and it will be quick".
   */
  protected async postAssetsWithRetry(
    body: Record<string, File>,
    jwt: string | undefined,
    expiresAt: number | undefined,
  ): Promise<{ jwt?: string }> {
    for (let attempt = 0; ; attempt++) {
      if (expiresAt !== undefined && (this.now?.() ?? 0) >= expiresAt) {
        throw new AlephaError(
          "The asset upload session expired before every file was sent. Cloudflare keeps what was already uploaded, so deploying again resumes from there rather than starting over.",
        );
      }
      try {
        return await this.postAssets(body, jwt);
      } catch (error) {
        if (attempt >= CloudflareDeployClient.MAX_UPLOAD_ATTEMPTS - 1) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 2 ** attempt * 1000),
        );
      }
    }
  }

  /**
   * One batch of assets, under the session's own credential.
   *
   * ⚠️ **The session's JWT, not the estate's API token.** This is the one call
   * in the whole deploy whose credential is not the client's own: the upload
   * session answers a token scoped to itself, and this endpoint authenticates
   * with that. Sending the API token instead is answered with a flat
   * `401 Unauthorized` that names nothing, and the client is built with the
   * API token, so without this override that is what goes.
   */
  protected async postAssets(
    body: Record<string, File>,
    jwt: string | undefined,
  ): Promise<{ jwt?: string }> {
    return await this.client.workers.assets.upload.create(
      {
        account_id: this.accountId,
        base64: true,
        body,
      },
      { headers: { authorization: `Bearer ${jwt}` } },
    );
  }

  /**
   * The script, its modules and its bindings.
   */
  /**
   * @returns the version this upload produced, when Cloudflare names one.
   *
   * ⚠️ **What makes a fast rollback possible.** Cloudflare keeps every uploaded
   * version server-side, so pointing at an older `version_id` is a rollback in
   * seconds with no artifact and no upload - working even under `latest`-only
   * retention. `undefined` when the response does not carry one, which a
   * rollback has to treat as "this run cannot be rolled back to" rather than as
   * an error here.
   */
  public async putScript(
    plan: CloudflareDeployPlan,
    assets?: { jwt: string },
  ): Promise<string | undefined> {
    const bindings = [
      ...(plan.bindings ?? []),
      ...Object.entries(plan.secrets ?? {}).map(([name, text]) => ({
        type: "secret_text",
        name,
        text,
      })),
    ];

    await this.uploadScript(plan, {
      main_module: plan.mainModule,
      compatibility_date: plan.compatibilityDate,
      compatibility_flags: plan.compatibilityFlags,
      bindings: bindings.length > 0 ? bindings : undefined,
      migrations: plan.migrations,
      observability: plan.observability,
      placement: plan.placement,
      limits: plan.limits,
      assets: plan.assets
        ? {
            config: plan.assets.config,
            // Present when this deploy uploaded something; absent when
            // Cloudflare already held the whole set, which is what
            // `keep_assets` is for.
            jwt: assets?.jwt,
            keep_assets: assets ? undefined : true,
          }
        : undefined,
    });

    return await this.newestVersion(plan.scriptName);
  }

  /**
   * The version this upload just produced, read back from Cloudflare.
   *
   * ## ⚠️ The upload response cannot answer this, and its `id` is a trap
   *
   * `PUT /workers/scripts/{name}` answers `{ startup_time_ms, id, ... }` where
   * `id` is **the script name**. There is no `version_id` in that shape at
   * all, so a `version_id ?? id` read stored `my-app-production` as the
   * version of every successful deploy - a value `RollbackService` then
   * compares against the real version list, never matches, and quietly falls
   * back to redeploying the artifact. Fast rollback could not work, and
   * nothing said so.
   *
   * ## ⚠️ A failure here must not fail the deploy
   *
   * The script is already live by the time this runs. `undefined` is a value
   * the caller already understands - "this run cannot be rolled back to" - and
   * it is much better than throwing away a Worker that deployed fine because a
   * bookkeeping read timed out.
   */
  protected async newestVersion(
    scriptName: string,
  ): Promise<string | undefined> {
    try {
      const versions = await this.listVersions(scriptName);
      // Cloudflare answers newest-first, but the sort makes that an assumption
      // this file states rather than one it inherits. `created_on` is optional;
      // when it is absent everywhere the comparison is a no-op and the API's
      // own order stands.
      return [...versions].sort((a, b) =>
        (b.created_on ?? "").localeCompare(a.created_on ?? ""),
      )[0]?.id;
    } catch {
      return undefined;
    }
  }

  /**
   * The multipart upload itself, in the shape Cloudflare documents.
   *
   * ## ⚠️ Hand-rolled, and the SDK's own `scripts.update` cannot do this
   *
   * Two things in `cloudflare@7` make that method wrong for a module Worker,
   * and neither announces itself:
   *
   * 1. It hardcodes `Content-Type: application/javascript` on a request whose
   *    body it then builds as multipart. Cloudflare believes the header, reads
   *    the raw multipart envelope as a classic service-worker script, and
   *    answers `Uncaught SyntaxError: Invalid or unexpected token at
   *    worker.js:1:2` - a file nobody wrote, at the `--` that opens the first
   *    boundary.
   * 2. Its `getName` does `.split(/[\\/]/).pop()` on every part, so a module
   *    at `server/chunk.js` is uploaded as `chunk.js`. The entry still imports
   *    `./server/chunk.js`, and every build with a chunk directory - which is
   *    every non-trivial build - ships a Worker whose imports dangle.
   *
   * So the body is composed here the way `wrangler` composes it: one
   * `metadata` part carrying JSON, then one part per module **named by its
   * full path**. `headers: { "Content-Type": null }` deletes the SDK's
   * hardcoded value so the boundary the form generates is the one sent.
   */
  protected async uploadScript(
    plan: CloudflareDeployPlan,
    metadata: Record<string, unknown>,
  ): Promise<unknown> {
    const form = new FormData();
    form.append(
      "metadata",
      new File([JSON.stringify(metadata)], "metadata.json", {
        type: "application/json",
      }),
    );

    for (const module of plan.modules) {
      // ⚠️ The part NAME is the module's full path, and it is what the entry's
      // import specifiers resolve against. The filename matches it so nothing
      // downstream has to reconcile two spellings.
      form.append(
        module.name,
        new File([module.bytes as never], module.name, {
          type: module.type ?? "application/javascript+module",
        }),
      );
    }

    const answer = (await this.client.put(
      `/accounts/${this.accountId}/workers/scripts/${plan.scriptName}`,
      {
        // ⚠️ An unresolvable `inherit` binding fails the upload instead of
        // silently blanking a secret, which is the failure mode the old
        // `wrangler secret put` ordering hand-rolled against.
        query: { bindings_inherit: "strict" },
        body: form,
        headers: { "Content-Type": null },
      },
    )) as { result?: unknown } | undefined;

    return (answer as { result?: unknown } | undefined)?.result ?? answer;
  }

  /**
   * Cron triggers.
   *
   * ⚠️ Called for an empty array too, and that is the point: a deploy that
   * stopped declaring a cron must stop firing it, and skipping the call would
   * leave the previous schedule running against new code.
   */
  public async putSchedules(plan: CloudflareDeployPlan): Promise<void> {
    if (!plan.crons) {
      return;
    }
    await this.client.workers.scripts.schedules.update(plan.scriptName, {
      account_id: this.accountId,
      body: plan.crons.map((cron) => ({ cron })),
    });
  }

  public async putDomain(plan: CloudflareDeployPlan): Promise<void> {
    if (!plan.domain) {
      return;
    }
    await this.client.workers.domains.update({
      account_id: this.accountId,
      hostname: plan.domain.hostname,
      service: plan.scriptName,
      zone_id: plan.domain.zoneId,
      zone_name: plan.domain.zoneName,
    });
  }

  /**
   * The `workers.dev` subdomain.
   *
   * ⚠️ The one call with no permission probe behind it, so its failure has to
   * name itself. An account that never registered a workers.dev subdomain
   * answers Cloudflare error `10007`, which is a fact about the account and not
   * about the token.
   *
   * ⚠️ **It reports rather than throws, and that is the important part.** By
   * the time this runs the script is uploaded and its database, buckets and
   * queues exist. Throwing here turns a Worker that is live and serving into
   * a deploy reported as failed, over a setting that only decides whether the
   * app also answers on a `*.workers.dev` host. Since this call now runs on
   * EVERY deploy - `enhanceDomain` writes the key in both directions - an
   * account with no subdomain would otherwise fail every deploy it ever made,
   * after the fact.
   *
   * @returns the reason it could not be set, or `undefined` on success.
   */
  public async putSubdomain(
    plan: CloudflareDeployPlan,
  ): Promise<string | undefined> {
    if (plan.workersDev === undefined) {
      return undefined;
    }
    try {
      await this.client.workers.scripts.subdomain.create(plan.scriptName, {
        account_id: this.accountId,
        enabled: plan.workersDev,
        previews_enabled: false,
      });
      return undefined;
    } catch (error) {
      return `Could not set the workers.dev subdomain for ${plan.scriptName}. If this account has never registered a workers.dev subdomain, register one or use a custom domain - no save-time probe can tell you this, because the probe that would have answers the same error for a valid token. (${error instanceof Error ? error.message : String(error)})`;
    }
  }

  /**
   * The account's `workers.dev` subdomain, which is the middle label of every
   * `<script>.<subdomain>.workers.dev` address.
   *
   * ⚠️ **No new token permission.** #F1224 finding 2 dropped the workers.dev
   * probe on the grounds that it proves the same permission group as the
   * `workers` probe - Workers Scripts - so an estate token that passes the six
   * probes can already read this. What that finding could not do was run the
   * call at SAVE time, because `10007` for an account with no subdomain is
   * indistinguishable from a bad token there. Deploy time is where the same
   * finding says the question belongs.
   *
   * ⚠️ **Never throws.** The address is a convenience read after a successful
   * upload; a failure here must not retroactively fail a deploy that worked.
   * `undefined` means "no address to show", whatever the reason, and the
   * caller says so.
   */
  public async getSubdomain(): Promise<string | undefined> {
    try {
      const answer = await this.client.workers.subdomains.get({
        account_id: this.accountId,
      });
      return answer?.subdomain || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Bind this Worker as the consumer of each queue, or rebind it.
   *
   * ## ⚠️ Idempotent, because a deploy is replayed
   *
   * A deploy is a `$job`, and a retried or rescheduled execution runs every
   * step again (`DeployJobs`). This was the one step that was a bare create,
   * and a create cannot be run twice: the replay would fail on the consumer
   * the first run bound, after the script was already live. So this is
   * wrangler's own rule, taken as it is: find this script's consumer on the
   * queue, PUT it if it is there, POST only if it is not.
   *
   * ⚠️ **Updated, never skipped.** A skip would freeze the consumer at what
   * the first deploy declared, so a setting added later - `max_batch_size`,
   * say - would never reach a consumer that already existed.
   *
   * ⚠️ **Matched by script, never "the queue's consumer".** The update names
   * the script it binds, so re-pointing another Worker's consumer here would
   * take that Worker's messages away from it without a word.
   */
  public async putQueueConsumers(plan: CloudflareDeployPlan): Promise<void> {
    for (const consumer of plan.queueConsumers ?? []) {
      const body = {
        type: "worker",
        script_name: plan.scriptName,
        dead_letter_queue: consumer.deadLetterQueue,
        settings: consumer.settings,
      };
      const existing = await this.consumerOf(consumer.queueId, plan.scriptName);
      if (existing) {
        await this.client.queues.consumers.update(existing, {
          account_id: this.accountId,
          queue_id: consumer.queueId,
          ...body,
        });
        continue;
      }
      await this.client.queues.consumers.create(consumer.queueId, {
        account_id: this.accountId,
        ...body,
      });
    }
  }

  /**
   * The id of the consumer this script already holds on a queue, if any.
   *
   * ⚠️ **Three spellings of one field.** The API reference and the SDK name
   * the Worker `script_name`, wrangler matches `script` or `service`, and
   * this repo's own `CloudflareApi` reads `service`. Missing whichever one
   * the API happens to answer would send a create, which is the refusal this
   * exists to avoid, so all three are accepted.
   */
  protected async consumerOf(
    queueId: string,
    scriptName: string,
  ): Promise<string | undefined> {
    const answer = await this.client.queues.consumers.list(queueId, {
      account_id: this.accountId,
    });
    return (answer.result ?? []).find(
      (it) =>
        !!it.consumer_id &&
        [it.script_name, it.script, it.service].includes(scriptName),
    )?.consumer_id;
  }

  /**
   * Every version Cloudflare still holds for this Worker, newest first.
   *
   * ⚠️ **This is what decouples rollback from retention.** Without it,
   * `latest`-only retention would leave nothing to roll back to, and the
   * epic's fast rollback would force a keep-N policy plus a GC job plus a pin
   * on whatever is live. With it, retention stays "one row, one object".
   */
  public async listVersions(
    scriptName: string,
  ): Promise<Array<{ id: string; created_on?: string }>> {
    const answer = await this.client.workers.scripts.versions.list(scriptName, {
      account_id: this.accountId,
    });
    // ⚠️ `result.items`, not `result`. This endpoint paginates as
    // `V4PagePagination`, whose `result` is an OBJECT wrapping `items` - unlike
    // `V4PagePaginationArray`, where `result` is the array. Reading `result`
    // here handed every caller a non-array that `.some()` and a spread both
    // choke on, so the version check inside a rollback and the version this
    // client reports after an upload were BOTH dead.
    return answer.result?.items ?? [];
  }

  /**
   * Point the Worker's live deployment at one version, wholly.
   *
   * ⚠️ **Seconds, with no artifact and no upload**, which is the whole reason
   * this path exists beside an artifact rollback. Cloudflare keeps every
   * uploaded version server-side, so the bytes are already there.
   *
   * ⚠️ `force` is deliberately NOT passed. Cloudflare blocks a rollback across
   * a change it considers unsafe - a secret that has since changed, a Durable
   * Object migration a version cannot be rolled past - and forcing past that is
   * a decision an operator makes with a warning in front of them, not a default
   * this method takes on their behalf.
   */
  public async rollbackTo(
    scriptName: string,
    versionId: string,
    message?: string,
  ): Promise<void> {
    await this.client.workers.scripts.deployments.create(scriptName, {
      account_id: this.accountId,
      strategy: "percentage",
      versions: [{ version_id: versionId, percentage: 100 }],
      annotations: message ? { "workers/message": message } : undefined,
    });
  }

  /**
   * Split the hashes Cloudflare asked for into requests this isolate can hold.
   *
   * The size is read from the manifest we already sent rather than from the
   * file, so the split is decided before a single byte is read.
   */
  /**
   * The server's own buckets, split where one is too big for this isolate.
   *
   * ## ⚠️ Cloudflare proposes the grouping, and it is not ours to improve
   *
   * The upload session answers `buckets`, already grouped. wrangler uploads
   * them exactly as handed over; this used to flatten them and re-group by its
   * own budget, which is a guess replacing an answer.
   *
   * What is kept from that budget is the SPLIT and never the merge: a bucket
   * larger than {@link BATCH_BYTES} is sent as several requests, because
   * wrangler's own cap is 98 MB and it does not run inside a 128 MB isolate.
   * Two buckets are never combined, so what reaches the API is always the
   * server's grouping or a subdivision of it.
   */
  protected *batches(
    buckets: string[][],
    manifest: Record<string, CloudflareAssetEntry>,
    byHash: Map<string, string>,
  ): Generator<string[]> {
    for (const bucket of buckets) {
      yield* this.split(bucket, manifest, byHash);
    }
  }

  protected *split(
    wanted: string[],
    manifest: Record<string, CloudflareAssetEntry>,
    byHash: Map<string, string>,
  ): Generator<string[]> {
    let batch: string[] = [];
    let bytes = 0;
    for (const hash of wanted) {
      const key = byHash.get(hash);
      // base64 is 4 bytes out for every 3 in, and the JSON body holds it as a
      // string, so the budget is spent in encoded bytes.
      const size = key ? Math.ceil((manifest[key]?.size ?? 0) / 3) * 4 : 0;
      if (
        batch.length > 0 &&
        (bytes + size > CloudflareDeployClient.BATCH_BYTES ||
          batch.length >= CloudflareDeployClient.BATCH_FILES)
      ) {
        yield batch;
        batch = [];
        bytes = 0;
      }
      batch.push(hash);
      bytes += size;
    }
    if (batch.length > 0) {
      yield batch;
    }
  }
}

/**
 * The slice of the SDK this class calls.
 *
 * Written out rather than taken from the SDK's own client type so a test can
 * pass a fake without reproducing a hundred resources, and so the seven calls
 * this quest owns are readable in one place.
 */
export interface CloudflareDeployApi {
  /**
   * The raw request escape hatch, used by {@link CloudflareDeployClient.uploadScript}
   * alone: the generated `workers.scripts.update` sends a multipart body under
   * an `application/javascript` header and basenames every part, so it cannot
   * upload a module Worker with a chunk directory.
   */
  put: (path: string, options: Record<string, unknown>) => Promise<unknown>;
  workers: {
    scripts: {
      update: (
        name: string,
        params: Record<string, unknown>,
      ) => Promise<unknown>;
      assets: {
        upload: {
          create: (
            name: string,
            params: {
              account_id: string;
              manifest: Record<string, CloudflareAssetEntry>;
            },
          ) => Promise<{ jwt?: string; buckets?: string[][] }>;
        };
      };
      schedules: {
        update: (
          name: string,
          params: { account_id: string; body: Array<{ cron: string }> },
        ) => Promise<unknown>;
      };
      versions: {
        /**
         * ⚠️ `result` is an OBJECT wrapping `items`, because this endpoint
         * paginates as `V4PagePagination` rather than `V4PagePaginationArray`.
         * The shape is spelled out here so a caller cannot read `result` as an
         * array again.
         */
        list: (
          name: string,
          params: { account_id: string },
        ) => Promise<{
          result?: { items?: Array<{ id: string; created_on?: string }> };
        }>;
      };
      deployments: {
        create: (
          name: string,
          params: {
            account_id: string;
            strategy: "percentage";
            versions: Array<{ version_id: string; percentage: number }>;
            annotations?: Record<string, string>;
          },
        ) => Promise<unknown>;
      };
      subdomain: {
        create: (
          name: string,
          params: {
            account_id: string;
            enabled: boolean;
            previews_enabled?: boolean;
          },
        ) => Promise<unknown>;
      };
    };
    assets: {
      upload: {
        create: (
          params: {
            account_id: string;
            base64: true;
            /**
             * ⚠️ `File` rather than `string`: the part's own `Content-Type` is
             * what Cloudflare serves the asset with, and only a `Blob` carries
             * one. See the call site.
             */
            body: Record<string, File>;
          },
          /**
           * ⚠️ Carries the session JWT, because this endpoint does not accept
           * the account's API token. Every other call in this interface takes
           * no options for exactly that reason.
           */
          options?: { headers: Record<string, string> },
        ) => Promise<{ jwt?: string }>;
      };
    };
    domains: {
      update: (params: {
        account_id: string;
        hostname: string;
        service: string;
        zone_id?: string;
        zone_name?: string;
      }) => Promise<unknown>;
    };
    /**
     * The ACCOUNT's workers.dev subdomain, singular - not to be confused with
     * `scripts.subdomain`, which turns one script's workers.dev host on and
     * off. This one answers the middle label every such host is built from.
     */
    subdomains: {
      get: (params: {
        account_id: string;
      }) => Promise<{ subdomain?: string } | undefined>;
    };
  };
  queues: {
    consumers: {
      create: (
        queueId: string,
        params: Record<string, unknown>,
      ) => Promise<unknown>;
      /**
       * ⚠️ `result` IS the array here, unlike `versions.list`: this endpoint
       * paginates as `SinglePage`, whose `result` is the list itself.
       */
      list: (
        queueId: string,
        params: { account_id: string },
      ) => Promise<{
        result?: Array<{
          consumer_id?: string;
          type?: string;
          script_name?: string;
          script?: string;
          service?: string;
        }>;
      }>;
      update: (
        consumerId: string,
        params: { account_id: string; queue_id: string } & Record<
          string,
          unknown
        >,
      ) => Promise<unknown>;
    };
  };
}
