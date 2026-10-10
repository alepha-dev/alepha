import { $atom, type Infer, z } from "alepha";

/**
 * Limits and windows of `@alepha/capacitor/ota-api`. Server only.
 */
export const otaApiOptions = $atom({
  name: "alepha.capacitor.ota.api.options",
  schema: z.object({
    /**
     * Largest encrypted bundle an upload may carry, in bytes.
     */
    maxBundleBytes: z.integer().min(1).default(100_000_000),

    /**
     * Largest a bundle may expand to once unpacked, in bytes.
     */
    maxExpandedBytes: z.integer().min(1).default(300_000_000),

    /**
     * Most files a bundle may hold.
     */
    maxFiles: z.integer().min(1).default(20_000),

    /**
     * Bundles kept per channel and compatibility cohort, beyond the active,
     * fallback and pinned ones, which are always kept.
     */
    retention: z.integer().min(1).default(10),

    /**
     * How long a download link stays valid, in seconds.
     */
    linkTtlSeconds: z.integer().min(30).default(600),

    /**
     * After how many minutes an upload that never became durable is
     * abandoned and cleaned up.
     */
    staleUploadMinutes: z.integer().min(1).default(60),

    /**
     * Update checks, stats batches and channel calls one address may send
     * per minute.
     */
    requestsPerMinute: z.integer().min(1).default(120),
  }),
  default: {
    maxBundleBytes: 100_000_000,
    maxExpandedBytes: 300_000_000,
    maxFiles: 20_000,
    retention: 10,
    linkTtlSeconds: 600,
    staleUploadMinutes: 60,
    requestsPerMinute: 120,
  },
});

export type OtaApiOptions = Infer<typeof otaApiOptions.schema>;
