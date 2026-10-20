import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider, type Timeout } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { AnalyticsFolds } from "../planner/AnalyticsFolds.ts";
import { AnalyticsRowFolder } from "../planner/AnalyticsRowFolder.ts";
import {
  AnalyticsProvider,
  type AnalyticsRow,
} from "../providers/AnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";

declare module "alepha" {
  interface Hooks {
    /**
     * A buffered dataset's rows were written: `rows` distinct keys, in
     * `durationMs` (retries included).
     */
    "analytics:flush:success": {
      dataset: string;
      rows: number;
      durationMs: number;
    };
    /**
     * A buffered dataset's flush failed every attempt and its `rows` were
     * dropped.
     */
    "analytics:flush:error": {
      dataset: string;
      rows: number;
      durationMs: number;
      error: Error;
    };
  }
}

/**
 * One dataset's pending rows, keyed by `(bucket, ...dimensions)`.
 */
interface PendingBuffer {
  dataset: AnalyticsDataset;
  rows: Map<string, AnalyticsRow>;
  timer?: Timeout;
  /**
   * The flush in flight, or a settled promise. A flush chains onto it, so
   * two flushes of one dataset never overlap.
   */
  flushing: Promise<void>;
}

/**
 * Buffers the writes of datasets that declare `buffer`, pre-folded in
 * memory, and flushes each as one `record()` of distinct keys.
 *
 * At 1k readings a second, one `record()` per reading is one upsert
 * statement each. A buffered dataset folds readings sharing a bucket and
 * dimensions as they arrive (every fold, through `AnalyticsFolds`), so a
 * flush writes one row per key however many readings it absorbed.
 *
 * - **A buffered `record()` resolves once the row is buffered**, not once it
 *   is stored. A crash loses at most one buffer per process; a caller that
 *   needs durability leaves `buffer` off.
 * - **Flushes on `maxRows` distinct keys, on `flushMs` after the first
 *   buffered row, and on `stop`**, which awaits the last flush, ahead of the
 *   database closing.
 * - **A failed flush is retried** {@link MAX_ATTEMPTS} times with backoff,
 *   then dropped and logged at `error` with its row count. Dropped rows are
 *   never merged back into the live buffer, which would grow it without
 *   bound during an outage.
 * - **Several instances** each keep their own buffer; the upsert merges
 *   their flushes, so nothing needs coordinating.
 *
 * Observability goes through hooks, `analytics:flush:success` and
 * `analytics:flush:error`, and {@link depth}: `alepha/server/metrics` is an
 * optional module, so this one never imports it, and an app wires the hooks
 * into its own metrics.
 */
export class AnalyticsBuffer {
  /**
   * Attempts per flush before its rows are dropped.
   */
  public static readonly MAX_ATTEMPTS = 3;

  /**
   * The wait before the second attempt, doubled before each later one.
   */
  public static readonly BACKOFF_MS = 100;

  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly provider = $inject(AnalyticsProvider);
  protected readonly pending = new Map<string, PendingBuffer>();

  /**
   * Flushes every buffer before the database closes: stop hooks run in
   * registration order and the ORM registers first.
   */
  protected readonly onStop = $hook({
    on: "stop",
    priority: "first",
    handler: () => this.flushAll(),
  });

  /**
   * Folds `rows` (stored form, see `AnalyticsRowFolder`) into `dataset`'s
   * buffer, and starts a flush when it holds `maxRows` keys.
   */
  public add(dataset: AnalyticsDataset, rows: AnalyticsRow[]): void {
    const options = dataset.buffer;
    if (!options) return;

    let buffer = this.pending.get(dataset.name);
    if (!buffer) {
      buffer = { dataset, rows: new Map(), flushing: Promise.resolve() };
      this.pending.set(dataset.name, buffer);
    }

    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    for (const row of rows) {
      const key = AnalyticsRowFolder.key(dimensions, row);
      const existing = buffer.rows.get(key);
      if (existing) {
        AnalyticsFolds.merge(dataset, existing, row);
      } else {
        buffer.rows.set(key, { ...row });
      }
    }

    if (buffer.rows.size >= options.maxRows) {
      void this.flush(dataset.name);
    } else if (!buffer.timer && buffer.rows.size > 0) {
      buffer.timer = this.dateTime.createTimeout(
        () => void this.flush(dataset.name),
        options.flushMs,
      );
    }
  }

  /**
   * How many distinct keys `dataset` holds, waiting for a flush.
   */
  public depth(dataset: string): number {
    return this.pending.get(dataset)?.rows.size ?? 0;
  }

  /**
   * Flushes `dataset`'s buffer once any flush already in flight has
   * finished. Never rejects: a failure is retried, then logged and dropped.
   */
  public flush(dataset: string): Promise<void> {
    const buffer = this.pending.get(dataset);
    if (!buffer) return Promise.resolve();
    buffer.flushing = buffer.flushing.then(() => this.flushNow(buffer));
    return buffer.flushing;
  }

  public async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((name) => this.flush(name)));
  }

  protected async flushNow(buffer: PendingBuffer): Promise<void> {
    if (buffer.timer) {
      this.dateTime.clearTimeout(buffer.timer);
      buffer.timer = undefined;
    }
    if (buffer.rows.size === 0) return;

    // Taken, not copied: rows recorded during the flush start the next one.
    const rows = [...buffer.rows.values()];
    buffer.rows = new Map();
    const dataset = buffer.dataset;
    const started = this.dateTime.nowMillis();

    for (let attempt = 1; ; attempt++) {
      try {
        await this.provider.record(dataset, rows);
        await this.alepha.events.emit("analytics:flush:success", {
          dataset: dataset.name,
          rows: rows.length,
          durationMs: this.dateTime.nowMillis() - started,
        });
        return;
      } catch (error) {
        if (attempt < AnalyticsBuffer.MAX_ATTEMPTS) {
          await this.dateTime.wait(
            AnalyticsBuffer.BACKOFF_MS * 2 ** (attempt - 1),
          );
          continue;
        }
        this.log.error(
          `Dropped ${rows.length} buffered row(s) of '${dataset.name}' after ${attempt} failed flushes`,
          error,
        );
        await this.alepha.events.emit("analytics:flush:error", {
          dataset: dataset.name,
          rows: rows.length,
          durationMs: this.dateTime.nowMillis() - started,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        return;
      }
    }
  }
}
