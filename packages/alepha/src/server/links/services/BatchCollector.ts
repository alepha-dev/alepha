import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { HttpClient, HttpError } from "alepha/server";

/**
 * Collects browser-side action calls within a microtask and
 * sends them as a single `POST /api/_batch` request.
 *
 * Key behaviors:
 * - Single call in the window → direct HTTP call (no batch overhead)
 * - Multiple calls → coalesced into one batch request
 * - Same action + same params/query/body → deduplicated, result shared
 * - Exceeding MAX_BATCH_SIZE → split into multiple batch calls
 * - Transport failure → all pending promises reject
 */
export class BatchCollector {
  protected static readonly MAX_BATCH_SIZE = 20;

  protected readonly log = $logger();
  protected readonly httpClient = $inject(HttpClient);

  protected pending: PendingBatchEntry[] = [];
  protected scheduled = false;

  /**
   * Add an action call to the batch. Returns the result when the batch resolves.
   */
  public add(entry: BatchEntry): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pending.push({ entry, resolve, reject });

      if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => {
          this.scheduled = false;
          this.flush().catch((err) => this.log.error(err));
        }, 10);
      }
    });
  }

  protected async flush(): Promise<void> {
    const batch = this.pending.splice(0);

    if (batch.length === 0) return;

    // Entries with a binary body (File/Blob) can't survive JSON-stringify, so
    // they must bypass the batch endpoint and use their direct (multipart)
    // call instead.
    const binaryEntries: PendingBatchEntry[] = [];
    const remaining: PendingBatchEntry[] = [];
    for (const item of batch) {
      if (this.hasBinaryBody(item.entry.body)) {
        binaryEntries.push(item);
      } else {
        remaining.push(item);
      }
    }
    for (const item of binaryEntries) {
      void item.entry
        .directCall()
        .then((r) => item.resolve(r))
        .catch((e) => item.reject(e));
    }

    if (remaining.length === 0) return;

    // Single request — skip batching, call directly via follow
    if (remaining.length === 1) {
      const item = remaining[0];
      try {
        const result = await item.entry.directCall();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
      return;
    }

    // Reassign so the rest of the function works on the filtered set.
    batch.length = 0;
    batch.push(...remaining);

    // Deduplicate: same action + same params → share result
    const { unique, indexMap } = this.dedupe(batch);

    // Split into chunks of MAX_BATCH_SIZE
    const chunks = this.chunk(unique, BatchCollector.MAX_BATCH_SIZE);

    try {
      const allResults = (
        await Promise.all(
          chunks.map((chunk) => {
            const actions = [...new Set(chunk.map((b) => b.entry.action))].join(
              ",",
            );

            return this.httpClient
              .fetch(`/api/_batch?actions=${actions}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(
                  chunk.map((b) => ({
                    action: b.entry.action,
                    params: b.entry.params,
                    query: b.entry.query,
                    body: b.entry.body,
                  })),
                ),
              })
              .then((res) => res.data as BatchResponse[]);
          }),
        )
      ).flat();

      // Distribute results back (including deduped slots)
      for (let i = 0; i < batch.length; i++) {
        const result = allResults[indexMap[i]];
        if (result.status >= 400) {
          batch[i].reject(
            new HttpError({
              message:
                result.error ?? `${result.action} failed (${result.status})`,
              status: result.status,
            }),
          );
        } else {
          batch[i].resolve(result.data);
        }
      }
    } catch (error) {
      // Transport-level failure — reject all pending promises
      for (const item of batch) {
        item.reject(error);
      }
    }
  }

  protected dedupe(batch: PendingBatchEntry[]): {
    unique: PendingBatchEntry[];
    indexMap: number[];
  } {
    const seen = new Map<string, number>();
    const unique: PendingBatchEntry[] = [];
    const indexMap: number[] = [];

    for (const item of batch) {
      const key = `${item.entry.action}:${JSON.stringify({
        params: item.entry.params,
        query: item.entry.query,
        body: item.entry.body,
      })}`;

      const existing = seen.get(key);
      if (existing !== undefined) {
        indexMap.push(existing);
      } else {
        const idx = unique.length;
        seen.set(key, idx);
        unique.push(item);
        indexMap.push(idx);
      }
    }

    return { unique, indexMap };
  }

  protected hasBinaryBody(body: unknown): boolean {
    if (!body || typeof body !== "object") return false;
    for (const v of Object.values(body as Record<string, unknown>)) {
      if (typeof Blob !== "undefined" && v instanceof Blob) return true;
      if (typeof File !== "undefined" && v instanceof File) return true;
    }
    return false;
  }

  protected chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}

// ---

export interface BatchEntry {
  action: string;
  params?: Record<string, any>;
  query?: Record<string, any>;
  body?: Record<string, any>;
  directCall: () => Promise<any>;
}

interface PendingBatchEntry {
  entry: BatchEntry;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

interface BatchResponse {
  action: string;
  status: number;
  data?: any;
  error?: string;
}
