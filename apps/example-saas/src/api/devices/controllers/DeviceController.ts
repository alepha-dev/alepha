import { type Page, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import { type Device, devices } from "../entities/devices.ts";

/**
 * Controller for managing devices (Gates, TVMs, Validators).
 *
 * Provides CRUD operations, status management, and device-specific
 * functionality for the SaaS fleet management.
 */
export class DeviceController {
  protected readonly log = $logger();
  protected readonly devices = $repository(devices);

  // ─────────────────────────────────────────────────────────────────────────────
  // List & Search
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all devices with pagination and filtering.
   * GET /admin/devices
   */
  findDevices = $action({
    path: "/admin/devices",
    secure: false,
    description: "Find all devices with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        type: t.optional(t.enum(["gate", "tvm", "validator"])),
        status: t.optional(
          t.enum(["online", "offline", "maintenance", "error", "disabled"]),
        ),
        stationId: t.optional(t.uuid()),
      }),
      response: t.page(devices.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.type) {
        where.type = { eq: query.type };
      }

      if (query.status) {
        where.status = { eq: query.status };
      }

      if (query.stationId) {
        where.stationId = { eq: query.stationId };
      }

      if (query.query) {
        where.or = [
          { name: { ilike: `%${query.query}%` } },
          { serialNumber: { ilike: `%${query.query}%` } },
          { stationName: { ilike: `%${query.query}%` } },
          { zone: { ilike: `%${query.query}%` } },
          { ipAddress: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.devices.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [
            { column: "type", direction: "asc" },
            { column: "name", direction: "asc" },
          ],
        },
      );

      return result as Page<Device>;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Get Single Device
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a single device by ID.
   * GET /admin/devices/:id
   */
  getDevice = $action({
    path: "/admin/devices/:id",
    secure: false,
    description: "Get a device by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: devices.schema,
    },
    handler: async ({ params }) => {
      return await this.devices.findById(params.id);
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Create Device
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Register a new device.
   * POST /admin/devices
   */
  createDevice = $action({
    method: "POST",
    path: "/admin/devices",
    secure: false,
    description: "Register a new device",
    schema: {
      body: t.object({
        // Required fields
        type: t.enum(["gate", "tvm", "validator"]),
        name: t.text(),
        serialNumber: t.text(),

        // Optional basic info
        model: t.optional(t.text()),
        manufacturer: t.optional(t.text()),
        firmwareVersion: t.optional(t.text()),

        // Location
        stationId: t.optional(t.uuid()),
        stationName: t.optional(t.text()),
        zone: t.optional(t.text()),
        position: t.optional(t.text()),

        // Network
        ipAddress: t.optional(t.text()),
        macAddress: t.optional(t.text()),
        apiEndpoint: t.optional(t.text()),

        // Gate-specific
        gateDirection: t.optional(t.enum(["entry", "exit", "bidirectional"])),
        gateWidth: t.optional(t.text()),
        gateHasAccessibilityFeatures: t.optional(t.boolean()),

        // TVM-specific
        tvmAcceptsCash: t.optional(t.boolean()),
        tvmAcceptsCard: t.optional(t.boolean()),
        tvmAcceptsContactless: t.optional(t.boolean()),
        tvmPrintsTickets: t.optional(t.boolean()),
        tvmLanguages: t.optional(t.array(t.text())),

        // Validator-specific
        validatorSupportsNfc: t.optional(t.boolean()),
        validatorSupportsBarcode: t.optional(t.boolean()),
        validatorSupportsQr: t.optional(t.boolean()),
        validatorSupportsMagstripe: t.optional(t.boolean()),

        // Maintenance
        installedAt: t.optional(t.date()),
        warrantyExpiresAt: t.optional(t.date()),

        // Config
        config: t.optional(t.any()),
        tags: t.optional(t.array(t.text())),
        notes: t.optional(t.text()),
      }),
      response: devices.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Registering new device", {
        type: body.type,
        name: body.name,
        serialNumber: body.serialNumber,
      });

      const device = await this.devices.create({
        ...body,
        status: "offline", // New devices start offline until first heartbeat
        totalTransactions: 0,
        todayTransactions: 0,
        totalErrors: 0,
      });

      this.log.info("Device registered", {
        id: device.id,
        type: device.type,
        serialNumber: device.serialNumber,
      });

      return device;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Update Device
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update a device.
   * PATCH /admin/devices/:id
   */
  updateDevice = $action({
    method: "PATCH",
    path: "/admin/devices/:id",
    secure: false,
    description: "Update a device",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        name: t.optional(t.text()),
        model: t.optional(t.text()),
        manufacturer: t.optional(t.text()),
        firmwareVersion: t.optional(t.text()),

        stationId: t.optional(t.uuid()),
        stationName: t.optional(t.text()),
        zone: t.optional(t.text()),
        position: t.optional(t.text()),

        ipAddress: t.optional(t.text()),
        macAddress: t.optional(t.text()),
        apiEndpoint: t.optional(t.text()),

        // Gate-specific
        gateDirection: t.optional(t.enum(["entry", "exit", "bidirectional"])),
        gateWidth: t.optional(t.text()),
        gateHasAccessibilityFeatures: t.optional(t.boolean()),

        // TVM-specific
        tvmAcceptsCash: t.optional(t.boolean()),
        tvmAcceptsCard: t.optional(t.boolean()),
        tvmAcceptsContactless: t.optional(t.boolean()),
        tvmPrintsTickets: t.optional(t.boolean()),
        tvmLanguages: t.optional(t.array(t.text())),

        // Validator-specific
        validatorSupportsNfc: t.optional(t.boolean()),
        validatorSupportsBarcode: t.optional(t.boolean()),
        validatorSupportsQr: t.optional(t.boolean()),
        validatorSupportsMagstripe: t.optional(t.boolean()),

        // Maintenance
        warrantyExpiresAt: t.optional(t.date()),
        maintenanceNotes: t.optional(t.text()),
        nextMaintenanceAt: t.optional(t.datetime()),

        config: t.optional(t.any()),
        tags: t.optional(t.array(t.text())),
        notes: t.optional(t.text()),
      }),
      response: devices.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating device", { id: params.id });

      const device = await this.devices.updateById(params.id, body);

      this.log.info("Device updated", { id: device.id });

      return device;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Delete Device
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Delete a device.
   * DELETE /admin/devices/:id
   */
  deleteDevice = $action({
    method: "DELETE",
    path: "/admin/devices/:id",
    secure: false,
    description: "Delete a device",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      this.log.info("Deleting device", { id: params.id });

      await this.devices.deleteById(params.id);

      this.log.info("Device deleted", { id: params.id });

      return { ok: true };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Status Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update device status (from device heartbeat or admin action).
   * POST /admin/devices/:id/status
   */
  updateDeviceStatus = $action({
    method: "POST",
    path: "/admin/devices/:id/status",
    secure: false,
    description: "Update device status",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        status: t.enum([
          "online",
          "offline",
          "maintenance",
          "error",
          "disabled",
        ]),
        errorMessage: t.optional(t.text()),
        healthScore: t.optional(t.integer({ minimum: 0, maximum: 100 })),
      }),
      response: devices.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating device status", {
        id: params.id,
        status: body.status,
      });

      const updates: Record<string, unknown> = {
        status: body.status,
        lastSeenAt: new Date().toISOString(),
      };

      if (body.healthScore !== undefined) {
        updates.healthScore = body.healthScore;
      }

      if (body.status === "error" && body.errorMessage) {
        updates.lastErrorAt = new Date().toISOString();
        updates.lastErrorMessage = body.errorMessage;
      }

      const device = await this.devices.updateById(params.id, updates);

      this.log.info("Device status updated", {
        id: device.id,
        status: device.status,
      });

      return device;
    },
  });

  /**
   * Enable a device.
   * POST /admin/devices/:id/enable
   */
  enableDevice = $action({
    method: "POST",
    path: "/admin/devices/:id/enable",
    secure: false,
    description: "Enable a disabled device",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: devices.schema,
    },
    handler: async ({ params }) => {
      this.log.info("Enabling device", { id: params.id });

      const device = await this.devices.updateById(params.id, {
        status: "offline", // Will become online on next heartbeat
      });

      this.log.info("Device enabled", { id: device.id });

      return device;
    },
  });

  /**
   * Disable a device.
   * POST /admin/devices/:id/disable
   */
  disableDevice = $action({
    method: "POST",
    path: "/admin/devices/:id/disable",
    secure: false,
    description: "Disable a device",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        reason: t.optional(t.text()),
      }),
      response: devices.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Disabling device", { id: params.id, reason: body.reason });

      const existingDevice = await this.devices.findById(params.id);

      const device = await this.devices.updateById(params.id, {
        status: "disabled",
        notes: body.reason
          ? `${existingDevice.notes ? `${existingDevice.notes}\n` : ""}Disabled: ${body.reason}`
          : existingDevice.notes,
      });

      this.log.info("Device disabled", { id: device.id });

      return device;
    },
  });

  /**
   * Set device to maintenance mode.
   * POST /admin/devices/:id/maintenance
   */
  setMaintenanceMode = $action({
    method: "POST",
    path: "/admin/devices/:id/maintenance",
    secure: false,
    description: "Set device to maintenance mode",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        notes: t.optional(t.text()),
        estimatedCompletionAt: t.optional(t.datetime()),
      }),
      response: devices.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Setting device to maintenance mode", { id: params.id });

      const device = await this.devices.updateById(params.id, {
        status: "maintenance",
        lastMaintenanceAt: new Date().toISOString(),
        maintenanceNotes: body.notes,
        nextMaintenanceAt: body.estimatedCompletionAt,
      });

      this.log.info("Device set to maintenance mode", { id: device.id });

      return device;
    },
  });

  /**
   * Complete maintenance and bring device back online.
   * POST /admin/devices/:id/maintenance/complete
   */
  completeMaintenace = $action({
    method: "POST",
    path: "/admin/devices/:id/maintenance/complete",
    secure: false,
    description: "Complete maintenance",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        notes: t.optional(t.text()),
        nextMaintenanceAt: t.optional(t.datetime()),
      }),
      response: devices.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Completing device maintenance", { id: params.id });

      const existingDevice = await this.devices.findById(params.id);

      const device = await this.devices.updateById(params.id, {
        status: "offline", // Will become online on next heartbeat
        maintenanceNotes: body.notes
          ? `${existingDevice.maintenanceNotes ? `${existingDevice.maintenanceNotes}\n` : ""}${new Date().toISOString().split("T")[0]}: ${body.notes}`
          : existingDevice.maintenanceNotes,
        nextMaintenanceAt: body.nextMaintenanceAt,
      });

      this.log.info("Device maintenance completed", { id: device.id });

      return device;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Device Heartbeat (for device-to-server communication)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Device heartbeat endpoint.
   * POST /devices/:serialNumber/heartbeat
   */
  deviceHeartbeat = $action({
    method: "POST",
    path: "/devices/:serialNumber/heartbeat",
    secure: false,
    description: "Device heartbeat (called by devices)",
    schema: {
      params: t.object({ serialNumber: t.text() }),
      body: t.object({
        status: t.optional(
          t.enum(["online", "offline", "maintenance", "error"]),
        ),
        healthScore: t.optional(t.integer({ minimum: 0, maximum: 100 })),
        errorMessage: t.optional(t.text()),
        firmwareVersion: t.optional(t.text()),
        // TVM-specific
        tvmCashLevel: t.optional(t.integer({ minimum: 0, maximum: 100 })),
        tvmPaperLevel: t.optional(t.integer({ minimum: 0, maximum: 100 })),
        // Stats
        transactionsSinceLastHeartbeat: t.optional(t.integer()),
      }),
      response: t.object({
        acknowledged: t.boolean(),
        serverTime: t.datetime(),
        commands: t.optional(t.array(t.any())), // Commands to execute
      }),
    },
    handler: async ({ params, body }) => {
      this.log.debug("Device heartbeat received", {
        serialNumber: params.serialNumber,
      });

      const device = await this.devices.findOne({
        where: { serialNumber: { eq: params.serialNumber } },
      });

      // Skip update if device is administratively disabled
      if (device.status === "disabled") {
        return {
          acknowledged: true,
          serverTime: new Date().toISOString(),
          commands: [{ type: "shutdown", reason: "Device is disabled" }],
        };
      }

      const updates: Record<string, unknown> = {
        lastSeenAt: new Date().toISOString(),
        status: body.status ?? "online",
      };

      if (body.healthScore !== undefined) {
        updates.healthScore = body.healthScore;
      }

      if (body.firmwareVersion) {
        updates.firmwareVersion = body.firmwareVersion;
      }

      if (body.status === "error" && body.errorMessage) {
        updates.lastErrorAt = new Date().toISOString();
        updates.lastErrorMessage = body.errorMessage;
        updates.totalErrors = device.totalErrors + 1;
      }

      // TVM-specific updates
      if (body.tvmCashLevel !== undefined) {
        updates.tvmCashLevel = body.tvmCashLevel;
      }
      if (body.tvmPaperLevel !== undefined) {
        updates.tvmPaperLevel = body.tvmPaperLevel;
      }

      // Update transaction counts
      if (body.transactionsSinceLastHeartbeat) {
        updates.totalTransactions =
          device.totalTransactions + body.transactionsSinceLastHeartbeat;
        updates.todayTransactions =
          device.todayTransactions + body.transactionsSinceLastHeartbeat;
      }

      await this.devices.updateById(device.id, updates);

      return {
        acknowledged: true,
        serverTime: new Date().toISOString(),
      };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Statistics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get device fleet statistics.
   * GET /admin/devices/stats
   */
  getDeviceStats = $action({
    path: "/admin/devices/stats",
    secure: false,
    description: "Get device fleet statistics",
    schema: {
      response: t.object({
        total: t.integer(),
        byType: t.object({
          gate: t.integer(),
          tvm: t.integer(),
          validator: t.integer(),
        }),
        byStatus: t.object({
          online: t.integer(),
          offline: t.integer(),
          maintenance: t.integer(),
          error: t.integer(),
          disabled: t.integer(),
        }),
        healthSummary: t.object({
          healthy: t.integer(), // healthScore >= 80
          warning: t.integer(), // healthScore 50-79
          critical: t.integer(), // healthScore < 50
          unknown: t.integer(), // no healthScore
        }),
        lowSupplies: t.object({
          tvmLowCash: t.integer(), // cashLevel < 20%
          tvmLowPaper: t.integer(), // paperLevel < 20%
        }),
      }),
    },
    handler: async () => {
      const allDevices = await this.devices.findMany({});

      const stats = {
        total: allDevices.length,
        byType: {
          gate: 0,
          tvm: 0,
          validator: 0,
        },
        byStatus: {
          online: 0,
          offline: 0,
          maintenance: 0,
          error: 0,
          disabled: 0,
        },
        healthSummary: {
          healthy: 0,
          warning: 0,
          critical: 0,
          unknown: 0,
        },
        lowSupplies: {
          tvmLowCash: 0,
          tvmLowPaper: 0,
        },
      };

      for (const device of allDevices) {
        // Count by type
        stats.byType[device.type]++;

        // Count by status
        stats.byStatus[device.status]++;

        // Health summary
        if (device.healthScore === undefined || device.healthScore === null) {
          stats.healthSummary.unknown++;
        } else if (device.healthScore >= 80) {
          stats.healthSummary.healthy++;
        } else if (device.healthScore >= 50) {
          stats.healthSummary.warning++;
        } else {
          stats.healthSummary.critical++;
        }

        // TVM supplies
        if (device.type === "tvm") {
          if (device.tvmCashLevel !== undefined && device.tvmCashLevel < 20) {
            stats.lowSupplies.tvmLowCash++;
          }
          if (device.tvmPaperLevel !== undefined && device.tvmPaperLevel < 20) {
            stats.lowSupplies.tvmLowPaper++;
          }
        }
      }

      return stats;
    },
  });

  /**
   * Get devices by station.
   * GET /admin/stations/:stationId/devices
   */
  getDevicesByStation = $action({
    path: "/admin/stations/:stationId/devices",
    secure: false,
    description: "Get all devices at a station",
    schema: {
      params: t.object({ stationId: t.uuid() }),
      response: t.array(devices.schema),
    },
    handler: async ({ params }) => {
      const stationDevices = await this.devices.findMany({
        where: { stationId: { eq: params.stationId } },
        orderBy: [
          { column: "type", direction: "asc" },
          { column: "name", direction: "asc" },
        ],
      });

      return stationDevices as Device[];
    },
  });

  /**
   * Reboot a device (fake action for now).
   * POST /admin/devices/:id/reboot
   */
  rebootDevice = $action({
    method: "POST",
    path: "/admin/devices/:id/reboot",
    secure: false,
    description: "Reboot a device",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.object({
        success: t.boolean(),
        message: t.text(),
        estimatedRecoveryTime: t.integer(),
      }),
    },
    handler: async ({ params }) => {
      this.log.info("Rebooting device", { id: params.id });

      // Update device status to show it's rebooting
      await this.devices.updateById(params.id, {
        status: "offline",
        lastSeenAt: new Date().toISOString(),
      });

      // Simulate reboot - in real world this would send command to device
      this.log.info("Device reboot command sent", { id: params.id });

      return {
        success: true,
        message: "Reboot command sent successfully",
        estimatedRecoveryTime: 30, // seconds
      };
    },
  });

  /**
   * Run diagnostics on a device (fake action for now).
   * POST /admin/devices/:id/diagnose
   */
  diagnoseDevice = $action({
    method: "POST",
    path: "/admin/devices/:id/diagnose",
    secure: false,
    description: "Run diagnostics on a device",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.object({
        success: t.boolean(),
        diagnostics: t.object({
          networkLatency: t.integer(),
          cpuUsage: t.integer(),
          memoryUsage: t.integer(),
          diskUsage: t.integer(),
          uptime: t.integer(),
          lastReboot: t.optional(t.text()),
        }),
      }),
    },
    handler: async ({ params }) => {
      this.log.info("Running diagnostics on device", { id: params.id });

      // Fake diagnostics data
      return {
        success: true,
        diagnostics: {
          networkLatency: Math.floor(Math.random() * 50) + 5,
          cpuUsage: Math.floor(Math.random() * 60) + 10,
          memoryUsage: Math.floor(Math.random() * 70) + 20,
          diskUsage: Math.floor(Math.random() * 50) + 30,
          uptime: Math.floor(Math.random() * 86400 * 30), // up to 30 days in seconds
          lastReboot: new Date(
            Date.now() - Math.floor(Math.random() * 86400000 * 7),
          ).toISOString(),
        },
      };
    },
  });

  /**
   * Reset daily transaction counters (called by scheduler).
   * POST /admin/devices/reset-daily-counters
   */
  resetDailyCounters = $action({
    method: "POST",
    path: "/admin/devices/reset-daily-counters",
    secure: false,
    description: "Reset daily transaction counters for all devices",
    schema: {
      response: t.object({
        devicesReset: t.integer(),
      }),
    },
    handler: async () => {
      this.log.info("Resetting daily transaction counters");

      const allDevices = await this.devices.findMany({});

      for (const device of allDevices) {
        await this.devices.updateById(device.id, {
          todayTransactions: 0,
        });
      }

      this.log.info("Daily counters reset", { count: allDevices.length });

      return { devicesReset: allDevices.length };
    },
  });
}
