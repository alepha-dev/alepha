import { md5 } from "@noble/hashes/legacy";
import { AlephaError } from "alepha";

import type {
  CloudflareD1,
  CloudflareD1Import,
  CloudflareD1QueryResult,
  CloudflareKV,
  CloudflareQueue,
  CloudflareR2,
} from "../schemas/cloudflare.ts";

/**
 * Creating the resources a Worker binds, from inside a Worker.
 *
 * ## ⚠️ Why this is not `CloudflareApi`
 *
 * Two reasons, and the second is a security one rather than a layering one.
 *
 * `CloudflareApi` injects `WranglerApi` for its token, which injects
 * `ShellProvider`, which reaches `node:child_process`. It can never enter a
 * Worker bundle.
 *
 * And its `resolveAccountId` falls back to `process.env.CLOUDFLARE_ACCOUNT_ID`,
 * which inside Lore's Worker is **Lore's own account**, set for Analytics
 * Engine. A provisioning client that resolved its account that way would create
 * a user's D1 database in the operator's account and bill it to them. So the
 * token and the account id are constructor arguments, from the estate row, and
 * nothing here reads the environment. Same contract as
 * `CloudflareDeployClient`, which is the class this one stands beside.
 *
 * ## Raw `fetch` rather than the SDK
 *
 * The deploy client uses the `cloudflare` SDK because the SDK builds the
 * multipart script upload, which is the fiddliest part of that flow.
 * Provisioning is plain JSON, so the SDK would buy nothing and cost the
 * `D1`, `KV`, `R2` and `Queues` resource trees in Lore's bundle.
 *
 * ## It is also the migration transport
 *
 * `d1Query`, `d1Import` and `resolveD1Id` satisfy `D1MigrationTransport`, so
 * the migrate step of a Worker deploy runs through this client rather than
 * through `CloudflareApi`. ⚠️ The two D1 methods are **not** interchangeable:
 * see `D1MigrationsService` for what `/query` does to a table rebuild, measured.
 */
export class CloudflareProvisionClient {
  protected static readonly BASE = "https://api.cloudflare.com/client/v4";

  protected readonly apiToken: string;
  protected readonly accountId: string;
  protected readonly jurisdiction?: "eu" | "fedramp";
  protected readonly baseURL: string;

  constructor(options: {
    apiToken: string;
    accountId: string;
    jurisdiction?: "eu" | "fedramp";
    baseURL?: string;
  }) {
    if (!options.apiToken) {
      throw new AlephaError(
        "Provisioning needs an API token from the estate. Nothing here falls back to the environment: that would create resources in the operator's own account.",
      );
    }
    if (!options.accountId) {
      throw new AlephaError(
        "Provisioning needs the estate's account id. Nothing here falls back to the environment.",
      );
    }
    this.apiToken = options.apiToken;
    this.accountId = options.accountId;
    this.jurisdiction = options.jurisdiction;
    this.baseURL = options.baseURL ?? CloudflareProvisionClient.BASE;
  }

  // -------------------------------------------------------------------------
  // D1
  // -------------------------------------------------------------------------

  public async listD1(): Promise<CloudflareD1[]> {
    return await this.paginate<CloudflareD1>(
      `/accounts/${this.accountId}/d1/database`,
    );
  }

  /**
   * The database of that name, creating it if the account has none.
   *
   * ⚠️ Idempotent on purpose. A deploy runs `provision` every time, and a
   * second `up` against the same environment must find the database it made
   * rather than refuse or make a second one.
   */
  public async ensureD1(name: string): Promise<CloudflareD1> {
    const existing = (await this.listD1()).find((it) => it.name === name);
    if (existing) {
      return existing;
    }
    // ⚠️ `jurisdiction` and `primary_location_hint` are mutually exclusive:
    // the API silently ignores the hint when a jurisdiction is set, which
    // reads as the hint being honoured.
    const body: Record<string, unknown> = { name };
    if (this.jurisdiction) {
      body.jurisdiction = this.jurisdiction;
    }
    return await this.fetch<CloudflareD1>(
      `/accounts/${this.accountId}/d1/database`,
      { method: "POST", body },
    );
  }

  public async resolveD1Id(name: string): Promise<string> {
    const found = (await this.listD1()).find((it) => it.name === name);
    if (!found) {
      const known = (await this.listD1()).map((it) => it.name).sort();
      throw new AlephaError(
        `No D1 database named '${name}' in this account.` +
          (known.length > 0 ? ` Found: ${known.join(", ")}.` : ""),
      );
    }
    return found.uuid;
  }

  /**
   * ⚠️ For the bookkeeping statements only. A migration FILE goes through
   * {@link d1Import}: this endpoint voids `PRAGMA foreign_keys=OFF`, measured
   * 0 of 5 child rows surviving a table rebuild against 5 of 5.
   */
  public async d1Query(
    databaseId: string,
    sql: string,
  ): Promise<CloudflareD1QueryResult[]> {
    return await this.fetch<CloudflareD1QueryResult[]>(
      `/accounts/${this.accountId}/d1/database/${databaseId}/query`,
      { method: "POST", body: { sql } },
    );
  }

  /**
   * `wrangler d1 execute --remote --file`, which is the only transport that
   * honours a table rebuild's pragma.
   */
  public async d1Import(databaseId: string, sql: string): Promise<void> {
    const bytes = new TextEncoder().encode(sql);
    const etag = this.hex(md5(bytes));
    const path = `/accounts/${this.accountId}/d1/database/${databaseId}/import`;

    let answer = await this.fetch<CloudflareD1Import>(path, {
      method: "POST",
      body: { action: "init", etag },
    });

    // D1 keys an upload by md5, so a file it has already ingested is already
    // applied and answers `complete` with no `filename`. An `ingest` after
    // that is refused as a malformed request.
    if (answer.status === "complete") {
      return;
    }

    if (answer.upload_url) {
      const uploaded = await globalThis.fetch(answer.upload_url, {
        method: "PUT",
        body: bytes as unknown as BodyInit,
      });
      if (!uploaded.ok) {
        throw new AlephaError(
          `D1 refused the migration upload (HTTP ${uploaded.status}).`,
        );
      }
      if (uploaded.headers.get("etag")?.replace(/^"|"$/g, "") !== etag) {
        throw new AlephaError(
          "The migration did not upload intact: D1's checksum does not match the file's.",
        );
      }
    }

    answer = await this.fetch<CloudflareD1Import>(path, {
      method: "POST",
      body: { action: "ingest", filename: answer.filename, etag },
    });

    for (let attempt = 0; attempt < 120; attempt++) {
      if (answer.status === "complete") {
        return;
      }
      if (answer.status === "error") {
        throw new AlephaError(
          `D1 could not apply the migration: ${(answer.errors ?? []).join("; ") || "no reason given"}.`,
        );
      }
      answer = await this.fetch<CloudflareD1Import>(path, {
        method: "POST",
        body: { action: "poll", current_bookmark: answer.at_bookmark },
      });
    }

    throw new AlephaError(
      "D1 was still applying the migration after 120 polls. It rolls back on failure, so this is safe to retry.",
    );
  }

  // -------------------------------------------------------------------------
  // R2, KV, queues
  // -------------------------------------------------------------------------

  public async listR2(): Promise<CloudflareR2[]> {
    const answer = await this.fetch<{ buckets?: CloudflareR2[] }>(
      `/accounts/${this.accountId}/r2/buckets`,
    );
    return answer.buckets ?? [];
  }

  public async ensureR2(name: string): Promise<void> {
    if ((await this.listR2()).some((it) => it.name === name)) {
      return;
    }
    await this.fetch(`/accounts/${this.accountId}/r2/buckets`, {
      method: "POST",
      body: { name },
    });
  }

  public async listKV(): Promise<CloudflareKV[]> {
    return await this.paginate<CloudflareKV>(
      `/accounts/${this.accountId}/storage/kv/namespaces`,
    );
  }

  public async ensureKV(title: string): Promise<CloudflareKV> {
    const existing = (await this.listKV()).find((it) => it.title === title);
    if (existing) {
      return existing;
    }
    return await this.fetch<CloudflareKV>(
      `/accounts/${this.accountId}/storage/kv/namespaces`,
      { method: "POST", body: { title } },
    );
  }

  public async listQueues(): Promise<CloudflareQueue[]> {
    return await this.paginate<CloudflareQueue>(
      `/accounts/${this.accountId}/queues`,
    );
  }

  public async ensureQueue(name: string): Promise<CloudflareQueue> {
    const existing = (await this.listQueues()).find(
      (it) => it.queue_name === name,
    );
    if (existing) {
      return existing;
    }
    return await this.fetch<CloudflareQueue>(
      `/accounts/${this.accountId}/queues`,
      { method: "POST", body: { queue_name: name } },
    );
  }

  // -------------------------------------------------------------------------
  // transport
  // -------------------------------------------------------------------------

  /**
   * Every page of a list endpoint.
   *
   * Bounded: a list that never stops growing is a Worker burning its CPU
   * budget on a page cursor that does not advance.
   */
  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /**
   * ⚠️ **There is deliberately no `deleteD1`, `deleteR2`, `deleteKV` or
   * `deleteQueue` here, and adding one is a decision, not a gap.**
   *
   * Lore drives this client with a credential lent to it for deploying. It may
   * remove what it can recreate - a Worker is a build, uploaded again by the
   * next deploy - and it may not remove what it cannot: a database, a bucket,
   * a namespace and a queue all hold data that no redeploy brings back and
   * that Cloudflare offers no rename or archive to sidestep (`d1.update` takes
   * only `read_replication`, `r2.edit` only a storage class).
   *
   * Leaving them is also what makes destroy-then-recreate work: `ensureD1` and
   * `ensureR2` look up by NAME, so a copy rebuilt under the same name finds
   * its database again with its rows intact.
   *
   * `alepha platform down` deletes them, and is the right place for it: it
   * runs on the operator's own machine against their own account.
   */

  /**
   * Delete a Worker script.
   *
   * `force` is deliberately not passed: it detaches a script other Workers
   * still bind to, which is a decision for whoever owns those, not for a
   * teardown of one copy.
   */
  public async deleteWorker(name: string): Promise<void> {
    await this.fetch(`/accounts/${this.accountId}/workers/scripts/${name}`, {
      method: "DELETE",
    });
  }

  protected async paginate<T>(path: string): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const batch = await this.fetch<T[]>(path, {
        query: { page: String(page), per_page: "100" },
      });
      all.push(...batch);
      if (batch.length < 100) {
        return all;
      }
    }
    return all;
  }

  protected async fetch<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const { method = "GET", body, query } = options;
    const url = query
      ? `${this.baseURL}${path}?${new URLSearchParams(query).toString()}`
      : `${this.baseURL}${path}`;

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiToken}`,
    };
    // R2 under a jurisdiction lives in a separate namespace, and every R2 call
    // has to say so or it addresses the global one.
    if (this.jurisdiction && path.includes("/r2/")) {
      headers["cf-r2-jurisdiction"] = this.jurisdiction;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await globalThis.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // A 5xx from Cloudflare or a proxy in front of it answers HTML or nothing,
    // and `response.json()` then throws a bare SyntaxError naming neither the
    // URL nor the status.
    const text = await response.text();
    let json: {
      success: boolean;
      result: T;
      errors: Array<{ message: string }>;
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new AlephaError(
        `Cloudflare returned a non-JSON response (${method} ${path}, HTTP ${response.status}): ${text.slice(0, 200).replace(/\s+/g, " ").trim() || "<empty body>"}`,
      );
    }

    if (!json.success) {
      throw new AlephaError(
        `Cloudflare API error (${method} ${path}): ${(json.errors ?? []).map((it) => it.message).join(", ")}`,
      );
    }

    return json.result;
  }

  protected hex(bytes: Uint8Array): string {
    let out = "";
    for (const byte of bytes) {
      out += byte.toString(16).padStart(2, "0");
    }
    return out;
  }
}
