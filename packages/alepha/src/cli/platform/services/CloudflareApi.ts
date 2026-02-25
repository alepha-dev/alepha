import { $inject, Alepha, AlephaError, type TSchema, t } from "alepha";
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
  cloudflareR2ListSchema,
  cloudflareSecretSchema,
  cloudflareVersionListSchema,
  cloudflareWorkerSchema,
  createD1BodySchema,
  createHyperdriveBodySchema,
  createKVBodySchema,
  createQueueBodySchema,
  createR2BodySchema,
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

    const res = await this.fetch<CloudflareAccount[]>("/accounts", {
      schema: t.array(cloudflareAccountSchema),
    });

    if (res.length === 0) {
      throw new AlephaError("No Cloudflare accounts found for this token.");
    }

    this.accountId = res[0].id;
    return this.accountId;
  }

  // -------------------------------------------------------------------------
  // D1
  // -------------------------------------------------------------------------

  public async listD1(): Promise<CloudflareD1[]> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareD1[]>(
      `/accounts/${accountId}/d1/database`,
      { schema: t.array(cloudflareD1Schema) },
    );
  }

  public async createD1(name: string): Promise<CloudflareD1> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareD1>(
      `/accounts/${accountId}/d1/database`,
      {
        method: "POST",
        body: { name },
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
    return await this.fetch<CloudflareKV[]>(
      `/accounts/${accountId}/storage/kv/namespaces`,
      { schema: t.array(cloudflareKVSchema) },
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
    const res = await this.fetch<{ buckets: CloudflareR2[] }>(
      `/accounts/${accountId}/r2/buckets`,
      { schema: cloudflareR2ListSchema },
    );
    return res.buckets;
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

  // -------------------------------------------------------------------------
  // Queues
  // -------------------------------------------------------------------------

  public async listQueues(): Promise<CloudflareQueue[]> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareQueue[]>(
      `/accounts/${accountId}/queues`,
      { schema: t.array(cloudflareQueueSchema) },
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
    return await this.fetch<CloudflareQueueConsumer[]>(
      `/accounts/${accountId}/queues/${queueId}/consumers`,
      { schema: t.array(cloudflareQueueConsumerSchema) },
    );
  }

  public async deleteQueueConsumer(
    queueId: string,
    consumerService: string,
  ): Promise<void> {
    const accountId = await this.resolveAccountId();
    await this.fetch(
      `/accounts/${accountId}/queues/${queueId}/consumers/${consumerService}`,
      { method: "DELETE" },
    );
  }

  // -------------------------------------------------------------------------
  // Hyperdrive
  // -------------------------------------------------------------------------

  public async listHyperdrive(): Promise<CloudflareHyperdrive[]> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareHyperdrive[]>(
      `/accounts/${accountId}/hyperdrive/configs`,
      { schema: t.array(cloudflareHyperdriveSchema) },
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
    const res = await this.fetch<{ deployments: CloudflareDeployment[] }>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`,
      { schema: cloudflareDeploymentListSchema },
    );
    return res.deployments;
  }

  public async listVersions(scriptName: string): Promise<CloudflareVersion[]> {
    const accountId = await this.resolveAccountId();
    const res = await this.fetch<{ items: CloudflareVersion[] }>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/versions`,
      { schema: cloudflareVersionListSchema },
    );
    return res.items;
  }

  // -------------------------------------------------------------------------
  // Secrets
  // -------------------------------------------------------------------------

  public async listSecrets(scriptName: string): Promise<CloudflareSecret[]> {
    const accountId = await this.resolveAccountId();
    return await this.fetch<CloudflareSecret[]>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
      { schema: t.array(cloudflareSecretSchema) },
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

  // -------------------------------------------------------------------------
  // Core fetch
  // -------------------------------------------------------------------------

  protected async fetch<T = unknown>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      bodySchema?: TSchema;
      schema?: TSchema;
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

    const init: RequestInit = { method, headers };

    if (body) {
      headers["Content-Type"] = "application/json";
      const validated = options.bodySchema
        ? this.alepha.codec.validate(options.bodySchema, body)
        : body;
      init.body = JSON.stringify(validated);
    }

    const response = await globalThis.fetch(url, init);
    const json = (await response.json()) as {
      success: boolean;
      result: T;
      errors: CloudflareApiError[];
    };

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
