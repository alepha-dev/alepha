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

  queueConsumers?: Array<{
    queueId: string;
    settings?: Record<string, unknown>;
    deadLetterQueue?: string;
  }>;

  assets?: CloudflareDeployAssets;
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
 * ⚠️ Step 6 has **no save-time permission probe standing behind it**. The
 * workers.dev probe was dropped from #1630 because
 * `GET /accounts/{id}/workers/subdomain` answers error `10007` for an account
 * that never registered one, which a probe would misread as a missing
 * permission and use to refuse a valid token. "This account has no workers.dev
 * subdomain" is therefore a deploy-time failure named here, not a save-time
 * refusal.
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

  protected readonly manifest = new CloudflareAssetManifest();
  protected readonly accountId: string;
  protected readonly client: CloudflareDeployApi;

  constructor(options: {
    apiToken: string;
    accountId: string;
    /**
     * A pre-built client, which is how a test drives this without a network.
     * Production passes neither.
     */
    client?: CloudflareDeployApi;
    baseURL?: string;
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
  ): Promise<{ versionId?: string }> {
    const assets = plan.assets
      ? await this.uploadAssets(plan.scriptName, plan.assets)
      : undefined;

    const versionId = await this.putScript(plan, assets);
    await this.putSchedules(plan);
    await this.putDomain(plan);
    await this.putSubdomain(plan);
    await this.putQueueConsumers(plan);

    return { versionId };
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

    // The manifest is keyed by served path and the buckets by hash, so the
    // upload needs the inverse. Built once rather than searched per file.
    const byHash = new Map<string, string>();
    for (const [key, entry] of Object.entries(assets.manifest)) {
      byHash.set(entry.hash, key);
    }

    let completion = session.jwt;
    for (const batch of this.batches(wanted, assets.manifest, byHash)) {
      const body: Record<string, string> = {};
      for (const hash of batch) {
        const key = byHash.get(hash);
        if (!key) {
          throw new AlephaError(
            `Cloudflare asked for an asset hash (${hash}) that is not in the manifest we sent. Refusing to guess which file it meant.`,
          );
        }
        body[hash] = this.manifest.base64(await assets.read(key));
      }

      const answer = await this.client.workers.assets.upload.create({
        account_id: this.accountId,
        base64: true,
        body,
      });
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
   */
  public async putSubdomain(plan: CloudflareDeployPlan): Promise<void> {
    if (plan.workersDev === undefined) {
      return;
    }
    try {
      await this.client.workers.scripts.subdomain.create(plan.scriptName, {
        account_id: this.accountId,
        enabled: plan.workersDev,
        previews_enabled: false,
      });
    } catch (error) {
      throw new AlephaError(
        `Could not set the workers.dev subdomain for ${plan.scriptName}. If this account has never registered a workers.dev subdomain, register one or deploy without it - no save-time probe can tell you this, because the probe that would have answers the same error for a valid token. (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  public async putQueueConsumers(plan: CloudflareDeployPlan): Promise<void> {
    for (const consumer of plan.queueConsumers ?? []) {
      await this.client.queues.consumers.create(consumer.queueId, {
        account_id: this.accountId,
        type: "worker",
        script_name: plan.scriptName,
        dead_letter_queue: consumer.deadLetterQueue,
        settings: consumer.settings as never,
      });
    }
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
  protected *batches(
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
        create: (params: {
          account_id: string;
          base64: true;
          body: Record<string, string>;
        }) => Promise<{ jwt?: string }>;
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
  };
  queues: {
    consumers: {
      create: (
        queueId: string,
        params: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  };
}
