import { $error } from "alepha";

/**
 * Thrown by a backend asked for a delay it cannot honour.
 *
 * Not a failure: the caller is expected to catch it and fall back to
 * whatever it has (for `$job`, a local promoting timer, and behind that the
 * outbox row's own `scheduledAt` plus the sweep). It exists so that
 * "I did not enqueue this" is impossible to confuse with "I enqueued it".
 *
 * ⚠️ **No in-tree backend throws this any more** - Cloudflare Queues,
 * memory and Redis all honour a delay - so it looks like dead code and is
 * not. It is the contract a custom `QueueProvider` implements, and
 * `JobQueueProvider`'s fallback for it is covered by a test double. Deleting
 * it would leave "ignore the delay and deliver now" as the only thing a
 * limited backend could do, which is the one behaviour this whole interface
 * exists to forbid.
 */
export const QueueDelayNotSupportedError = $error({
  name: "QUEUE_DELAY_NOT_SUPPORTED",
  message: "This queue provider does not support delayed messages",
});

export type QueueDelayNotSupportedError = InstanceType<
  typeof QueueDelayNotSupportedError
>;
