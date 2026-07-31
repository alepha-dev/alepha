import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * An app Pulse observes.
 *
 * Two kinds, and the difference is only where the app runs. A `bay` app is one
 * this Pulse's own Bay hosts, so its identity is already known from the control
 * socket and its row is created automatically. An `external` app is anywhere
 * else — Cloudflare, someone else's machine — and is enrolled by hand.
 *
 * Both push telemetry the same way, over HTTP with a key. Pulse never reaches
 * out to an app: an observer that needs to connect to what it watches is an
 * observer that stops working the moment a firewall changes.
 *
 * The key is stored hashed, like `api_keys`: a leaked database should not be a
 * leaked fleet. `ingestKeyPrefix` exists so the UI can show *which* key a row
 * belongs to without being able to reconstruct it.
 */
export const pulseApps = $entity({
  name: "pulse_apps",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    /** URL-safe identifier, unique per Pulse. */
    slug: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    /** `bay` = hosted by this Pulse's Bay; `external` = anywhere else. */
    kind: z.enum(["bay", "external"]).meta({ mode: "text" }),
    ingestKeyHash: z.string().min(1).max(256),
    ingestKeyPrefix: z.string().min(1).max(32),
    /**
     * Per-app overrides for what this app should send: sampling rates, metric
     * interval, tracker kill-switches. Served verbatim as the app's config.
     *
     * JSON rather than columns because it is a payload Pulse forwards, not
     * something it queries on — and because adding a knob should not be a
     * migration on every deployment.
     */
    appetite: db.default(z.record(z.string(), z.any()), {}),
    /** Where this app's users file a petition, handed to it in its config. */
    petitionUrl: z.string().max(2000).optional(),
    /**
     * Lore integration: `{ url, campaignId, keyCipher }`, or absent.
     *
     * `keyCipher` is encrypted at rest with `APP_SECRET`. Pulse's SQLite is
     * backed up to S3 by Bay, and a campaign-scoped key sitting in cleartext
     * inside a backup is an avoidable leak.
     */
    lore: z.record(z.string(), z.any()).optional(),
    createdAt: db.createdAt(),
    /**
     * Set instead of deleting the row.
     *
     * The error groups and analytics collected under this app stay meaningful
     * after its key is revoked; deleting the app would take its history with
     * it, which is the opposite of what an observer is for.
     */
    revokedAt: z.string().optional(),
  }),
  indexes: [
    { columns: ["slug"], unique: true },
    { columns: ["ingestKeyHash"], unique: true },
  ],
});

export type PulseApp = Static<typeof pulseApps.schema>;
export type PulseAppInsert = Static<typeof pulseApps.insertSchema>;
