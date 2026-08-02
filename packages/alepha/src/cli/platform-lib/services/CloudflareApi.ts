import { $inject, Alepha, AlephaError, type ZType, z } from "alepha";
import { $logger } from "alepha/logger";
import type {
  CloudflareAccount,
  CloudflareApiError,
  CloudflareD1,
  CloudflareDeployment,
  CloudflareHyperdrive,
  CloudflareKV,
  CloudflareQueue,
  CloudflareQueueConsumer,
  CloudflareR2,
  CloudflareR2Token,
  CloudflareSecret,
  CloudflareVersion,
  CloudflareWorker,
} from "../schemas/cloudflare.ts";
import {
  cloudflareAccountSchema,
  cloudflareD1Schema,
  cloudflareDeploymentListSchema,
  cloudflareHyperdriveSchema,
  cloudflareKVSchema,
  cloudflareQueueConsumerSchema,
  cloudflareQueueSchema,
  cloudflareR2Schema,
  cloudflareR2TokenSchema,
  cloudflareSecretSchema,
  cloudflareVersionSchema,
  cloudflareWorkerSchema,
  createD1BodySchema,
  createHyperdriveBodySchema,
  createKVBodySchema,
  createQueueBodySchema,
  createR2BodySchema,
  createR2TokenBodySchema,
  putSecretBodySchema,
} from "../schemas/cloudflare.ts";
import { WranglerApi } from "./WranglerApi.ts";

export type {
  CloudflareD1,
  CloudflareDeployment,
  CloudflareHyperdrive,
  CloudflareKV,
  CloudflareQueue,
  CloudflareQueueConsumer,
  CloudflareR2,
  CloudflareR2Token,
  CloudflareSecret,
  CloudflareVersion,
  CloudflareWorker,
};

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

/**
 * Thin wrapper over the Cloudflare REST API.
 *
 * Uses `wrangler auth token` to obtain credentials,
 * then calls `fetch()` directly for all CRUD operations.
 */
export class CloudflareApi {
  protected static readonly BASE = "https://api.cloudflare.com/client/v4";

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly wrangler = $inject(WranglerApi);

  protected token?: string;
  protected accountId?: string;
  protected jurisdiction?: "eu" | "fedramp";

  /**
   * Set the Cloudflare data jurisdiction for R2 and D1 resources.
   *
   * R2 buckets and D1 databases created under a jurisdiction live in a
   * separate namespace — every R2 API call (list/create/delete) must include
   * the `cf-r2-jurisdiction` header, and D1 create must include the field
   * in the request body. Omit / pass `undefined` for the default (global).
   */
  public setJurisdiction(jurisdiction?: "eu" | "fedramp"): void {
    this.jurisdiction = jurisdiction;
  }

  /**
   * Override the Cloudflare account ID (from platform config).
   *
   * When unset, `resolveAccountId` falls back to `CLOUDFLARE_ACCOUNT_ID` env
   * var or the token's single account.
   */
  public setAccountId(accountId?: string): void {
    this.accountId = accountId;
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /**
   * Obtain the current auth token from wrangler.
   */
  public async resolveToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    this.token = await this.wrangler.getAuthToken();
    return this.token;
  }

  /**
   * Resolve the Cloudflare account ID.
   *
   * Calls /accounts and picks the first one. Cached after first call.
   */
  public async resolveAccountId(): Promise<string> {
    if (this.accountId) {
      return this.accountId;
    }

    const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (fromEnv) {
      this.accountId = fromEnv;
      return this.accountId;
    }

    const res = await this.fetch<CloudflareAccount[]>("/accounts", {
      schema: z.array(cloudflareAccountSchema),
    });

    if (res.length === 0) {
      throw new AlephaError("No Cloudflare accounts found for this token.");
    }

    if (res.length > 1) {
      const list = res.map((a) => `  - ${a.id}  ${a.name}`).join("\n");
      throw new AlephaError(
        `Cloudflare token has access to ${res.length} accounts; set ` +
          `\`CLOUDFLARE_ACCOUNT_ID\` or the \`accountId\` field in your ` +
          `platform config to pick one:\n${list}`,
      );
    }

    this.accountId = res[0].id;
    return this.accountId;
  }

  // -------------------------------------------------------------------------
  // D1
  // -------------------------------------------------------------------------

  public async listD1(): Promise<CloudflareD1[]> {
    const accountId = await this.resolveAccountId();
    return await this.paginate<CloudflareD1>(
      `/accounts/${accountId}/d1/database`,
      cloudflareD1Schema,
    );
  }

  public async createD1(
    name: string,
    location = "weur", // TODO: move to config (or auto-resolve based on account info, or ask ?)
  ): Promise<CloudflareD1> {
    const accountId = await this.resolveAccountId();
    // When jurisdiction is set, `primary_location_hint` is silently ignored
    // by the API, so omit it to avoid confusion.
    const body: Record<string, unknown> = { name };
    if (this.jurisdiction) {
      body.jurisdiction = this.jurisdiction;
    } else {
      body.primary_location_hint = location;
    }
    return await this.fetch<CloudflareD1>(
      `/accounts/${accountId}/d1/database`,
      {
        method: "POST",
        body,
        bodySchema: createD1BodySchema,
        schema: cloudflareD1Schema,
      },
    );
  }

  public async deleteD1(databaseId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(`/accounts/${accountId}/d1/database/${databaseId}`, {
      method: "DELETE",
    });
  }

  // -------------------------------------------------------------------------
  // KV
  // -------------------------------------------------------------------------

  public async listKV(): Promise<CloudflareKV[]> {
    const accountId = await this.resolveAccountId();
    return await this.paginate<CloudflareKV>(
      `/accounts/${accountId}/storage/kv/namespaces`,
      cloudflareKVSchema,
      100, // KV list caps at 100 per page
    );
  }

  public async createKV(title: string): Promise<CloudflareKV> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareKV>(
      `/accounts/${accountId}/storage/kv/namespaces`,
      {
        method: "POST",
        body: { title },
        bodySchema: createKVBodySchema,
        schema: cloudflareKVSchema,
      },
    );
  }

  public async deleteKV(namespaceId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`,
      { method: "DELETE" },
    );
  }

  // -------------------------------------------------------------------------
  // R2
  // -------------------------------------------------------------------------

  public async listR2(): Promise<CloudflareR2[]> {
    const accountId = await this.resolveAccountId();
    return await this.paginateCursor<CloudflareR2>(
      `/accounts/${accountId}/r2/buckets`,
      "buckets",
      cloudflareR2Schema,
    );
  }

  public async createR2(name: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(`/accounts/${accountId}/r2/buckets`, {
      method: "POST",
      body: { name },
      bodySchema: createR2BodySchema,
    });
  }

  public async deleteR2(name: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(`/accounts/${accountId}/r2/buckets/${name}`, {
      method: "DELETE",
    });
  }

  /**
   * Mint a bucket-scoped R2 API token (S3 access key + secret) using the
   * current bearer token. Used by teardown to wipe a bucket over the S3
   * protocol without requiring users to pre-create R2 access keys.
   *
   * The returned token should be revoked with `deleteR2Token` as soon as the
   * wipe is done.
   */
  public async createR2Token(
    name: string,
    bucket: string,
  ): Promise<CloudflareR2Token> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareR2Token>(
      `/accounts/${accountId}/r2/api-tokens`,
      {
        method: "POST",
        body: {
          name,
          policies: [
            {
              effect: "allow",
              permissions: ["admin-read-write"],
              buckets: [bucket],
            },
          ],
        },
        bodySchema: createR2TokenBodySchema,
        schema: cloudflareR2TokenSchema,
      },
    );
  }

  public async deleteR2Token(tokenId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(`/accounts/${accountId}/r2/api-tokens/${tokenId}`, {
      method: "DELETE",
    });
  }

  // -------------------------------------------------------------------------
  // Queues
  // -------------------------------------------------------------------------

  public async listQueues(): Promise<CloudflareQueue[]> {
    const accountId = await this.resolveAccountId();
    return await this.paginate<CloudflareQueue>(
      `/accounts/${accountId}/queues`,
      cloudflareQueueSchema,
    );
  }

  public async createQueue(name: string): Promise<CloudflareQueue> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareQueue>(`/accounts/${accountId}/queues`, {
      method: "POST",
      body: { queue_name: name },
      bodySchema: createQueueBodySchema,
      schema: cloudflareQueueSchema,
    });
  }

  public async deleteQueue(queueId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(`/accounts/${accountId}/queues/${queueId}`, {
      method: "DELETE",
    });
  }

  public async listQueueConsumers(
    queueId: string,
  ): Promise<CloudflareQueueConsumer[]> {
    const accountId = await this.resolveAccountId();
    return await this.paginate<CloudflareQueueConsumer>(
      `/accounts/${accountId}/queues/${queueId}/consumers`,
      cloudflareQueueConsumerSchema,
    );
  }

  public async deleteQueueConsumer(
    queueId: string,
    consumerService: string,
  ): Promise<void> {
    const accountId = await this.resolveAccountId();
    const consumers = await this.listQueueConsumers(queueId);
    const consumer = consumers.find((c) => c.service === consumerService);
    if (!consumer) {
      return;
    }
    await this.fetch(
      `/accounts/${accountId}/queues/${queueId}/consumers/${consumer.consumer_id}`,
      { method: "DELETE" },
    );
  }

  // -------------------------------------------------------------------------
  // Hyperdrive
  // -------------------------------------------------------------------------

  public async listHyperdrive(): Promise<CloudflareHyperdrive[]> {
    const accountId = await this.resolveAccountId();
    return await this.paginate<CloudflareHyperdrive>(
      `/accounts/${accountId}/hyperdrive/configs`,
      cloudflareHyperdriveSchema,
    );
  }

  public async createHyperdrive(
    name: string,
    connectionString: string,
  ): Promise<CloudflareHyperdrive> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareHyperdrive>(
      `/accounts/${accountId}/hyperdrive/configs`,
      {
        method: "POST",
        body: {
          name,
          origin: this.parseConnectionString(connectionString),
        },
        bodySchema: createHyperdriveBodySchema,
        schema: cloudflareHyperdriveSchema,
      },
    );
  }

  public async deleteHyperdrive(configId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(`/accounts/${accountId}/hyperdrive/configs/${configId}`, {
      method: "DELETE",
    });
  }

  // -------------------------------------------------------------------------
  // Workers
  // -------------------------------------------------------------------------

  public async getWorker(
    scriptName: string,
  ): Promise<CloudflareWorker | undefined> {
    const accountId = await this.resolveAccountId();
    try {
      return await this.fetch<CloudflareWorker>(
        `/accounts/${accountId}/workers/scripts/${scriptName}`,
        { schema: cloudflareWorkerSchema },
      );
    } catch {
      return undefined;
    }
  }

  public async deleteWorker(scriptName: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(`/accounts/${accountId}/workers/scripts/${scriptName}`, {
      method: "DELETE",
      query: { force: "true" },
    });
  }

  public async listDeployments(
    scriptName: string,
  ): Promise<CloudflareDeployment[]> {
    const accountId = await this.resolveAccountId();
    // Deployments list is wrapped in `{ deployments }` and returns newest
    // first; for picking the active deployment we only need the top page.
    const res = await this.fetch<{ deployments: CloudflareDeployment[] }>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`,
      { schema: cloudflareDeploymentListSchema, query: { per_page: "100" } },
    );
    return res.deployments;
  }

  public async listVersions(scriptName: string): Promise<CloudflareVersion[]> {
    const accountId = await this.resolveAccountId();
    return await this.paginateCursor<CloudflareVersion>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/versions`,
      "items",
      cloudflareVersionSchema,
    );
  }

  // -------------------------------------------------------------------------
  // Secrets
  // -------------------------------------------------------------------------

  public async listSecrets(scriptName: string): Promise<CloudflareSecret[]> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareSecret[]>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
      { schema: z.array(cloudflareSecretSchema) },
    );
  }

  public async putSecret(
    scriptName: string,
    name: string,
    value: string,
  ): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(
      `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
      {
        method: "PUT",
        body: { name, text: value, type: "secret_text" },
        bodySchema: putSecretBodySchema,
      },
    );
  }

  /**
   * Fetch the current worker bindings via the script-settings endpoint.
   * Used to merge new secrets into the existing binding set in one PATCH
   * (avoids the per-secret `putSecret` calls, each of which creates a
   * Cloudflare deployment — pushing 7 secrets meant 7 deployment rows).
   *
   * Secret bindings come back with `name` + `type` but no `text` (they're
   * write-only on Cloudflare's side); to preserve them across a PATCH we
   * forward each one as `{ type, name }` and Cloudflare keeps the stored
   * value.
   */
  public async getWorkerSettings(scriptName: string): Promise<{
    bindings: Array<{ type: string; name: string; text?: string }>;
  }> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<{
      bindings: Array<{ type: string; name: string; text?: string }>;
    }>(`/accounts/${accountId}/workers/scripts/${scriptName}/settings`);
  }

  /**
   * Replace the worker's binding set in one call (= one Cloudflare
   * deployment, regardless of how many secrets are being updated).
   *
   * The endpoint expects multipart FormData with a `settings` field whose
   * value is a JSON-encoded `{ bindings: [...] }` — the `fetch` helper
   * above is JSON-only, so this one bypasses it and calls `globalThis.fetch`
   * directly. Mirrors what `wrangler secret bulk` does internally.
   */
  public async patchWorkerBindings(
    scriptName: string,
    bindings: Array<{ type: string; name: string; text?: string }>,
  ): Promise<void> {
    const accountId = await this.resolveAccountId();
    const token = await this.resolveToken();
    const url = `${CloudflareApi.BASE}/accounts/${accountId}/workers/scripts/${scriptName}/settings`;

    const form = new FormData();
    form.set("settings", JSON.stringify({ bindings }));

    const response = await globalThis.fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const json = (await response.json().catch(() => null)) as {
      success?: boolean;
      errors?: CloudflareApiError[];
    } | null;

    if (!response.ok || !json?.success) {
      const messages = json?.errors?.map((e) => e.message).join(", ");
      throw new AlephaError(
        `Cloudflare API error (PATCH /workers/scripts/${scriptName}/settings): ${
          messages ?? response.statusText
        }`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Core fetch
  // -------------------------------------------------------------------------

  protected async fetch<T = unknown>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      bodySchema?: ZType;
      schema?: ZType;
      query?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const token = await this.resolveToken();
    const { method = "GET", body, query } = options;

    let url = `${CloudflareApi.BASE}${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    if (this.jurisdiction && /\/r2\//.test(path)) {
      headers["cf-r2-jurisdiction"] = this.jurisdiction;
    }

    const init: RequestInit = { method, headers };

    if (body) {
      headers["Content-Type"] = "application/json";
      const validated = options.bodySchema
        ? this.alepha.codec.validate(options.bodySchema, body)
        : body;
      init.body = JSON.stringify(validated);
    }

    const response = await globalThis.fetch(url, init);
    // A 5xx from Cloudflare (or a proxy in front of it) answers HTML or an
    // empty body; `response.json()` then threw a bare SyntaxError naming
    // neither the URL nor the status, which is a miserable thing to debug.
    const text = await response.text();
    let json: {
      success: boolean;
      result: T;
      errors: CloudflareApiError[];
      result_info?: {
        page: number;
        per_page: number;
        total_pages?: number;
        count?: number;
        total_count?: number;
      };
    };

    try {
      json = JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim();
      throw new AlephaError(
        `Cloudflare API returned a non-JSON response (${method} ${path}, ` +
          `HTTP ${response.status}): ${snippet || "<empty body>"}`,
      );
    }

    if (!json.success) {
      const messages = json.errors.map((e) => e.message).join(", ");
      throw new AlephaError(
        `Cloudflare API error (${method} ${path}): ${messages}`,
      );
    }

    if (options.schema) {
      return this.alepha.codec.validate(options.schema, json.result) as T;
    }

    return json.result;
  }

  /**
   * Paginate a page-based list endpoint (`result_info.total_pages`).
   *
   * Cloudflare defaults to `per_page=20`; we push it to 1000 (max on most
   * list endpoints) and loop if more pages exist. Each page is validated
   * against the item schema.
   */
  protected async paginate<T>(
    path: string,
    itemSchema: ZType,
    perPage = 1000,
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;

    while (true) {
      const token = await this.resolveToken();
      const url = `${CloudflareApi.BASE}${path}?per_page=${perPage}&page=${page}`;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (this.jurisdiction && /\/r2\//.test(path)) {
        headers["cf-r2-jurisdiction"] = this.jurisdiction;
      }

      const response = await globalThis.fetch(url, { method: "GET", headers });
      const json = (await response.json()) as {
        success: boolean;
        result: T[];
        errors: CloudflareApiError[];
        result_info?: { page: number; total_pages?: number };
      };

      if (!json.success) {
        const messages = json.errors.map((e) => e.message).join(", ");
        throw new AlephaError(
          `Cloudflare API error (GET ${path}): ${messages}`,
        );
      }

      const validated = this.alepha.codec.validate(
        z.array(itemSchema),
        json.result,
      ) as T[];
      results.push(...validated);

      const totalPages = json.result_info?.total_pages;
      if (!totalPages || page >= totalPages || validated.length === 0) {
        break;
      }
      page++;
    }

    return results;
  }

  /**
   * Paginate a cursor-based list endpoint where `result` is an object
   * containing both the items array and a `cursor` field (R2 buckets,
   * Workers versions). Returns the flattened item array.
   */
  protected async paginateCursor<T>(
    path: string,
    itemsKey: string,
    itemSchema: ZType,
    perPage = 1000,
  ): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | undefined;

    while (true) {
      const query: Record<string, string> = { per_page: String(perPage) };
      if (cursor) {
        query.cursor = cursor;
      }

      const res = await this.fetch<Record<string, unknown>>(path, { query });
      const items = (res[itemsKey] as unknown[]) ?? [];
      const validated = this.alepha.codec.validate(
        z.array(itemSchema),
        items,
      ) as T[];
      results.push(...validated);

      const nextCursor = res.cursor as string | undefined;
      if (!nextCursor || validated.length === 0) {
        break;
      }
      cursor = nextCursor;
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Parse a postgres:// connection string into Hyperdrive origin fields.
   */
  protected parseConnectionString(connectionString: string): {
    scheme: string;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  } {
    const url = new URL(connectionString);
    return {
      scheme: "postgres",
      host: url.hostname,
      port: Number(url.port) || 5432,
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }
}
