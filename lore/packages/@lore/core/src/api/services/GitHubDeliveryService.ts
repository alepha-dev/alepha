import { $inject } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  $repository,
  DbConflictError,
  DbEntityNotFoundError,
} from "alepha/orm";

import {
  type GitHubDelivery,
  githubDeliveries,
} from "../entities/githubDeliveries.ts";
import { githubRedeliveries } from "../entities/githubRedeliveries.ts";
import { GitHubClient } from "./GitHubClient.ts";
import { GitHubText } from "./GitHubText.ts";
import { GitHubWebhookHandlers } from "./GitHubWebhookHandlers.ts";
import { ProjectRepositoryService } from "./ProjectRepositoryService.ts";

/**
 * What the endpoint answers for a delivery whose signature passed.
 */
export type GitHubStoreAnswer = "accepted" | "duplicate" | "dropped";

/**
 * A stored delivery's life (#Q4364, epic #E177): stored before it is
 * answered, handled in the background, retried by a sweep, and asked again
 * of GitHub when Lore never stored it.
 *
 * ## Store, then answer
 *
 * {@link store} inserts the row under GitHub's GUID: that insert is the
 * dedupe, and a GUID already present is a duplicate, acknowledged and not
 * handled. The endpoint answers 202 at once and hands the row to
 * `BackgroundTaskProvider.defer` (`waitUntil` on workerd): fire and forget,
 * so {@link sweep} picks up a row left `pending` for more than a minute and
 * retries a `failed` one, up to {@link MAX_ATTEMPTS}.
 *
 * ## Dispatch
 *
 * {@link handle} resolves the repository's numeric id to its project
 * (`ProjectRepositoryService.byRepositoryId`) and runs every handler the
 * event registered (`GitHubWebhookHandlers`). A repository-scoped event of a
 * repository no project holds is `dropped`. A handler must be idempotent.
 *
 * ## Redelivery
 *
 * GitHub does not retry a failed delivery by itself. {@link redeliver} reads
 * the App's recent deliveries and asks GitHub to redeliver each one that did
 * not get a 2xx and whose GUID Lore never stored, once per GUID.
 */
export class GitHubDeliveryService {
  public static readonly MAX_ATTEMPTS = 5;

  /**
   * Bodies above this are acknowledged and dropped (GitHub caps at 25 MB).
   */
  public static readonly MAX_BYTES = 1_048_576;

  /**
   * How long a delivery is kept: GitHub lists its own for three days.
   */
  public static readonly KEEP_MS = 7 * 24 * 3_600_000;

  /**
   * How old a `pending` row must be before the sweep takes it: the deferred
   * handling is given its minute first.
   */
  public static readonly PENDING_GRACE_MS = 60_000;

  protected readonly log = $logger();
  protected readonly rows = $repository(githubDeliveries);
  protected readonly asks = $repository(githubRedeliveries);
  protected readonly handlers = $inject(GitHubWebhookHandlers);
  protected readonly repositories = $inject(ProjectRepositoryService);
  protected readonly client = $inject(GitHubClient);
  protected readonly text = $inject(GitHubText);
  protected readonly background = $inject(BackgroundTaskProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Stores a verified delivery, then defers its handling.
   */
  async store(input: {
    delivery: string;
    event: string;
    body: Uint8Array;
  }): Promise<GitHubStoreAnswer> {
    const now = this.dateTime.nowISOString();
    const oversized = input.body.byteLength > GitHubDeliveryService.MAX_BYTES;
    const raw = oversized ? "" : new TextDecoder().decode(input.body);
    const payload = oversized ? undefined : this.parse(raw);
    const installation = this.text.object(payload?.installation);
    const repository = this.text.object(payload?.repository);
    const repositoryId = this.text.integer(repository?.id);
    const status = oversized || !payload ? "dropped" : "pending";
    try {
      await this.rows.create({
        id: input.delivery.slice(0, 64),
        event: input.event.slice(0, 64),
        ...(payload && this.text.text(payload.action, 64)
          ? { action: this.text.text(payload.action, 64) }
          : {}),
        ...(this.text.integer(installation?.id) !== undefined
          ? { installationId: this.text.integer(installation?.id) }
          : {}),
        ...(repositoryId !== undefined ? { repositoryId } : {}),
        ...(this.text.text(repository?.full_name, 201)
          ? { repository: this.text.text(repository?.full_name, 201) }
          : {}),
        status,
        attempts: 0,
        ...(oversized ? { lastError: "Body over 1 MB" } : {}),
        ...(!oversized && !payload ? { lastError: "Body is not JSON" } : {}),
        ...(status === "pending" ? { payload: raw } : {}),
        receivedAt: now,
      });
    } catch (error) {
      if (error instanceof DbConflictError) return "duplicate";
      throw error;
    }
    if (status === "dropped") return "dropped";
    this.background.defer(async () => {
      await this.handle(input.delivery.slice(0, 64));
    });
    return "accepted";
  }

  /**
   * Handles one stored delivery: idempotent, and safe to run twice.
   */
  async handle(id: string): Promise<GitHubDelivery["status"] | undefined> {
    const [row] = await this.rows.findMany({
      where: { id: { eq: id } },
      limit: 1,
    });
    if (!row || row.status === "handled" || row.status === "dropped") {
      return row?.status;
    }
    const now = this.dateTime.nowMillis();
    if (
      row.status === "handling" &&
      Date.parse(row.handledAt ?? "") >
        now - GitHubDeliveryService.PENDING_GRACE_MS
    ) {
      return "handling";
    }
    const attempts = row.attempts + 1;
    // The claim, on the state this run read: the deferred task, the sweep
    // and a direct call can reach one delivery together, and D1 has no
    // lock. The loser leaves it to the winner.
    try {
      await this.rows.updateOne(
        {
          id: { eq: row.id },
          status: { eq: row.status },
          attempts: { eq: row.attempts },
        },
        {
          status: "handling",
          attempts,
          handledAt: new Date(now).toISOString(),
        },
      );
    } catch (error) {
      if (error instanceof DbEntityNotFoundError) return "handling";
      throw error;
    }
    const payload = row.payload ? this.parse(row.payload) : undefined;
    if (!payload) {
      await this.finish(row, "dropped", attempts, "No payload");
      return "dropped";
    }
    const handlers = this.handlers.handlersOf(row.event);
    if (handlers.length === 0) {
      await this.finish(row, "dropped", attempts);
      return "dropped";
    }
    let connection;
    if (this.handlers.projectScoped(row.event)) {
      connection =
        row.repositoryId === undefined
          ? undefined
          : await this.repositories.byRepositoryId(row.repositoryId);
      if (!connection) {
        await this.finish(
          row,
          "dropped",
          attempts,
          "No project holds this repository",
        );
        return "dropped";
      }
    }
    try {
      for (const handler of handlers) {
        await handler.handle({
          delivery: row.id,
          event: row.event,
          ...(row.action ? { action: row.action } : {}),
          ...(row.installationId !== undefined
            ? { installationId: row.installationId }
            : {}),
          payload,
          ...(connection ? { connection } : {}),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn("GitHub delivery failed", {
        delivery: row.id,
        event: row.event,
        attempts,
      });
      await this.rows.updateById(row.id, {
        status: "failed",
        attempts,
        lastError: message.slice(0, 500),
        ...(connection ? { projectId: connection.projectId } : {}),
      });
      return "failed";
    }
    await this.finish(
      row,
      "handled",
      attempts,
      undefined,
      connection?.projectId,
    );
    return "handled";
  }

  /**
   * Retries what the deferred handling left: `pending` past its grace, and
   * `failed` under the attempt cap. Prunes rows past seven days.
   */
  async sweep(): Promise<{ handled: number; pruned: number }> {
    const now = this.dateTime.nowMillis();
    const stale = new Date(
      now - GitHubDeliveryService.PENDING_GRACE_MS,
    ).toISOString();
    const rows = await this.rows.findMany({
      where: {
        or: [
          { status: { eq: "pending" }, receivedAt: { lt: stale } },
          // A run that died holding its claim.
          { status: { eq: "handling" }, handledAt: { lt: stale } },
          {
            status: { eq: "failed" },
            attempts: { lt: GitHubDeliveryService.MAX_ATTEMPTS },
          },
        ],
      },
      limit: 50,
    });
    let handled = 0;
    for (const row of rows) {
      if ((await this.handle(row.id)) === "handled") handled++;
    }
    const cutoff = new Date(now - GitHubDeliveryService.KEEP_MS).toISOString();
    const pruned =
      (await this.rows.deleteMany({ receivedAt: { lt: cutoff } })).length +
      (await this.asks.deleteMany({ askedAt: { lt: cutoff } })).length;
    return { handled, pruned };
  }

  /**
   * Asks GitHub to redeliver what it could not hand over: each recent
   * delivery without a 2xx, whose GUID Lore never stored and never asked
   * for. One pass reads at most three pages of GitHub's list.
   */
  async redeliver(): Promise<number> {
    let cursor: string | undefined;
    let asked = 0;
    for (let page = 0; page < 3; page++) {
      const answer = await this.client.listHookDeliveries(cursor);
      const failed = answer.deliveries.filter(
        (it) =>
          !it.redelivery &&
          (it.status_code < 200 || it.status_code >= 300) &&
          typeof it.guid === "string",
      );
      for (const delivery of failed) {
        const guid = delivery.guid.slice(0, 64);
        const [stored] = await this.rows.findMany({
          where: { id: { eq: guid } },
          limit: 1,
        });
        if (stored) continue;
        try {
          await this.asks.create({
            id: guid,
            hookDeliveryId: delivery.id,
            askedAt: this.dateTime.nowISOString(),
          });
        } catch (error) {
          if (error instanceof DbConflictError) continue;
          throw error;
        }
        await this.client.redeliverHookDelivery(delivery.id);
        asked++;
      }
      if (!answer.next) break;
      cursor = answer.next;
    }
    return asked;
  }

  /**
   * The last deliveries, newest first, for Admin > GitHub: never a body.
   */
  async recent(limit = 50): Promise<Array<Omit<GitHubDelivery, "payload">>> {
    const rows = await this.rows.findMany({
      orderBy: [{ column: "receivedAt", direction: "desc" }],
      limit,
    });
    return rows.map(({ payload: _payload, ...row }) => row);
  }

  /**
   * When GitHub last reached the endpoint with a signed delivery.
   */
  async lastReceivedAt(): Promise<string | undefined> {
    const [row] = await this.rows.findMany({
      orderBy: [{ column: "receivedAt", direction: "desc" }],
      limit: 1,
    });
    return row?.receivedAt;
  }

  protected async finish(
    row: GitHubDelivery,
    status: "handled" | "dropped",
    attempts: number,
    lastError?: string,
    projectId?: number,
  ): Promise<void> {
    await this.rows.updateById(row.id, {
      status,
      attempts,
      handledAt: this.dateTime.nowISOString(),
      // The body goes once the delivery is settled.
      payload: null as unknown as undefined,
      ...(lastError ? { lastError } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    });
  }

  protected parse(raw: string): Record<string, unknown> | undefined {
    try {
      return this.text.object(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
}
