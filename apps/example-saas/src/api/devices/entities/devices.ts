import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

/**
 * Device types in the system.
 *
 * - gate: Access control gates (entry/exit barriers)
 * - tvm: Ticket Vending Machines for purchasing tickets
 * - validator: Ticket validators for checking/scanning tickets
 */
export type DeviceType = "gate" | "tvm" | "validator";

/**
 * Device operational status.
 *
 * - online: Device is connected and operational
 * - offline: Device is not responding/disconnected
 * - maintenance: Device is under maintenance
 * - error: Device has reported an error
 * - disabled: Device is administratively disabled
 */
export type DeviceStatus =
  | "online"
  | "offline"
  | "maintenance"
  | "error"
  | "disabled";

/**
 * Gate direction configuration.
 */
export type GateDirection = "entry" | "exit" | "bidirectional";

/**
 * Devices entity - manages Gates, TVMs, and Validators.
 *
 * Each device is associated with a station and can be monitored
 * for health status, usage statistics, and maintenance scheduling.
 */
export const devices = $entity({
  name: "devices",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // ─────────────────────────────────────────────────────────────────────────
    // Basic Information
    // ─────────────────────────────────────────────────────────────────────────

    type: pg.enum(["gate", "tvm", "validator"]),
    name: t.text(), // Human-readable name (e.g., "Gate A1", "TVM-North-01")
    serialNumber: t.text(), // Manufacturer serial number
    model: t.optional(t.text()), // Device model (e.g., "Scheidt & Bachmann SB-5000")
    manufacturer: t.optional(t.text()), // Manufacturer name
    firmwareVersion: t.optional(t.text()), // Current firmware version

    // ─────────────────────────────────────────────────────────────────────────
    // Location
    // ─────────────────────────────────────────────────────────────────────────

    stationId: t.optional(t.uuid()), // Associated station
    stationName: t.optional(t.text()), // Denormalized for quick display
    zone: t.optional(t.text()), // Zone within station (e.g., "Platform 1", "Main Hall")
    position: t.optional(t.text()), // Specific position (e.g., "North Entrance", "Near Exit B")

    // ─────────────────────────────────────────────────────────────────────────
    // Status & Health
    // ─────────────────────────────────────────────────────────────────────────

    status: pg.default(
      pg.enum(["online", "offline", "maintenance", "error", "disabled"]),
      "offline",
    ),
    lastSeenAt: t.optional(t.datetime()), // Last heartbeat/communication
    lastErrorAt: t.optional(t.datetime()),
    lastErrorMessage: t.optional(t.text()),
    healthScore: t.optional(t.integer({ minimum: 0, maximum: 100 })), // 0-100 health percentage

    // ─────────────────────────────────────────────────────────────────────────
    // Network Configuration
    // ─────────────────────────────────────────────────────────────────────────

    ipAddress: t.optional(t.text()),
    macAddress: t.optional(t.text()),
    apiEndpoint: t.optional(t.text()), // Device API URL if applicable

    // ─────────────────────────────────────────────────────────────────────────
    // Gate-Specific Fields
    // ─────────────────────────────────────────────────────────────────────────

    gateDirection: t.optional(pg.enum(["entry", "exit", "bidirectional"])),
    gateWidth: t.optional(t.text()), // e.g., "standard", "wide" (for wheelchairs/luggage)
    gateHasAccessibilityFeatures: t.optional(t.boolean()),

    // ─────────────────────────────────────────────────────────────────────────
    // TVM-Specific Fields
    // ─────────────────────────────────────────────────────────────────────────

    tvmAcceptsCash: t.optional(t.boolean()),
    tvmAcceptsCard: t.optional(t.boolean()),
    tvmAcceptsContactless: t.optional(t.boolean()),
    tvmPrintsTickets: t.optional(t.boolean()),
    tvmLanguages: t.optional(t.array(t.text())), // Supported languages
    tvmCashLevel: t.optional(t.integer({ minimum: 0, maximum: 100 })), // Cash hopper level %
    tvmPaperLevel: t.optional(t.integer({ minimum: 0, maximum: 100 })), // Ticket paper level %

    // ─────────────────────────────────────────────────────────────────────────
    // Validator-Specific Fields
    // ─────────────────────────────────────────────────────────────────────────

    validatorSupportsNfc: t.optional(t.boolean()),
    validatorSupportsBarcode: t.optional(t.boolean()),
    validatorSupportsQr: t.optional(t.boolean()),
    validatorSupportsMagstripe: t.optional(t.boolean()),

    // ─────────────────────────────────────────────────────────────────────────
    // Maintenance
    // ─────────────────────────────────────────────────────────────────────────

    installedAt: t.optional(t.date()),
    warrantyExpiresAt: t.optional(t.date()),
    lastMaintenanceAt: t.optional(t.datetime()),
    nextMaintenanceAt: t.optional(t.datetime()),
    maintenanceNotes: t.optional(t.text()),

    // ─────────────────────────────────────────────────────────────────────────
    // Usage Statistics (denormalized for quick access)
    // ─────────────────────────────────────────────────────────────────────────

    totalTransactions: pg.default(t.integer(), 0), // Total operations performed
    todayTransactions: pg.default(t.integer(), 0), // Reset daily
    totalErrors: pg.default(t.integer(), 0), // Total errors logged
    uptimePercent: t.optional(t.number()), // Calculated uptime percentage

    // ─────────────────────────────────────────────────────────────────────────
    // Configuration
    // ─────────────────────────────────────────────────────────────────────────

    config: t.optional(t.json()), // Device-specific JSON configuration
    tags: t.optional(t.array(t.text())), // Tags for grouping/filtering
    notes: t.optional(t.text()), // Admin notes
  }),
  indexes: [
    { columns: ["type"] },
    { columns: ["serialNumber"], unique: true },
    { columns: ["status"] },
    { columns: ["stationId"] },
    { columns: ["ipAddress"] },
  ],
});

export type Device = Static<typeof devices.schema>;
