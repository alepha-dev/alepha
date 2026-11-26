import { appNameSchema, projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

import { monitorExpectSchema } from "../../api/schemas/monitorExpectSchema.ts";
import { monitorHeartbeatResourceSchema } from "../../api/schemas/monitorHeartbeatResourceSchema.ts";
import { monitorIncidentResourceSchema } from "../../api/schemas/monitorIncidentResourceSchema.ts";
import { monitorResourceSchema } from "../../api/schemas/monitorResourceSchema.ts";
import { monitorUptimeCardSchema } from "../../api/schemas/monitorUptimeCardSchema.ts";
import { monitorWindowSchema } from "../../api/schemas/monitorWindowSchema.ts";

// -----------------------------------------------------------------------------
// shared
// -----------------------------------------------------------------------------

const monitorIdSchema = z
  .uuid()
  .describe("The monitor's id, from `monitor_list`.");

const windowSchema = monitorWindowSchema
  .describe("The window `uptimePct` covers: 24h (default), 7d or 30d.")
  .optional();

/**
 * The settings a monitor takes, every one optional: `monitor_create` requires
 * `name`, `kind` and `target` itself, and `monitor_update` merges what it is
 * given over the monitor's current settings.
 */
const monitorSettingsParams = {
  name: z.string().min(1).max(200).describe("Display name.").optional(),
  kind: z
    .enum(["http", "tcp", "cert", "push"])
    .describe(
      "`http` requests a URL, `tcp` opens host:port, `cert` reads a TLS certificate's expiry at host:port, `push` waits for the monitored job to call Lore. `tcp` and `cert` need a self-hosted Lore on Node: one on Workers refuses them.",
    )
    .optional(),
  target: z
    .string()
    .max(2048)
    .describe(
      "An http(s) URL for `http`, host:port for `tcp` and `cert`, empty for `push`.",
    )
    .optional(),
  interval_secs: z
    .integer()
    .min(60)
    .multipleOf(60)
    .describe(
      "Seconds between checks, a multiple of 60. For `push`, the longest gap between two pushes.",
    )
    .optional(),
  timeout_secs: z
    .integer()
    .min(1)
    .max(30)
    .describe("Seconds before a check gives up, 1 to 30.")
    .optional(),
  confirmations: z
    .integer()
    .min(1)
    .max(100)
    .describe("Failed checks in a row before the monitor goes down.")
    .optional(),
  grace_host: z
    .string()
    .max(64)
    .describe(
      "A host of the project, by slug, whose watched unit `grace_unit` this monitor follows: while that unit starts or stops, a failed check is held, so a deploy pages nobody. Empty string clears.",
    )
    .optional(),
  grace_unit: z
    .string()
    .max(200)
    .describe(
      "The watched unit on `grace_host` (e.g. `api.service`). Empty string clears.",
    )
    .optional(),
  grace_secs: z
    .integer()
    .min(60)
    .max(86_400)
    .describe(
      "How long a start may last before a failure counts again, in seconds (default 1500).",
    )
    .optional(),
  expect: monitorExpectSchema
    .describe(
      "What a passing check looks like: `status` (HTTP code), `keyword` (in the body), `latencyBudgetMs` (slower is a failure), `certWarningDays`. Replaces the whole object on update.",
    )
    .optional(),
};

// -----------------------------------------------------------------------------
// monitor_list
// -----------------------------------------------------------------------------

/**
 * The app copy a monitor belongs to, as the app tools name it (#Q3657).
 */
const appCopyParams = {
  app: appNameSchema.describe(
    "The app the monitor belongs to, e.g. `acme`, as `app_instance_list` names it.",
  ),
  env: appNameSchema.describe("Which copy of that app, e.g. `production`."),
};

export const monitorListParamsSchema = projectParamsSchema.extend({
  window: windowSchema,
});

export const monitorListResultSchema = z.object({
  monitors: z.array(
    monitorResourceSchema.extend({
      app: z.string().optional().describe("The app this monitor belongs to."),
      env: z.string().optional().describe("Which copy of that app."),
      uptimePct: z
        .number()
        .nullable()
        .describe("Share of passing checks in the window; null before any."),
    }),
  ),
  window: monitorWindowSchema,
  estimated: z.boolean(),
});

// -----------------------------------------------------------------------------
// monitor_get
// -----------------------------------------------------------------------------

export const monitorGetParamsSchema = z.object({ monitor_id: monitorIdSchema });

export const monitorGetResultSchema = z.object({
  monitor: monitorResourceSchema,
  uptime: z.array(monitorUptimeCardSchema),
  incidents: z.array(monitorIncidentResourceSchema),
  recentChecks: z.array(monitorHeartbeatResourceSchema),
  estimated: z.boolean(),
});

// -----------------------------------------------------------------------------
// monitor_create
// -----------------------------------------------------------------------------

export const monitorCreateParamsSchema = projectParamsSchema.extend({
  ...appCopyParams,
  ...monitorSettingsParams,
  name: monitorSettingsParams.name.unwrap(),
  kind: monitorSettingsParams.kind.unwrap(),
  target: monitorSettingsParams.target
    .unwrap()
    .describe(
      "An http(s) URL for `http`, host:port for `tcp` and `cert`, empty for `push`. For `http`, defaults to the app copy's address.",
    )
    .optional(),
});

export const monitorCreateResultSchema = z.object({
  monitor: monitorResourceSchema,
  token: z
    .string()
    .describe(
      "A push monitor's token, shown ONCE: nothing can read it back. Absent for the other kinds.",
    )
    .optional(),
});

// -----------------------------------------------------------------------------
// monitor_update
// -----------------------------------------------------------------------------

export const monitorUpdateParamsSchema = z.object({
  monitor_id: monitorIdSchema,
  ...monitorSettingsParams,
});

// -----------------------------------------------------------------------------
// monitor_pause, monitor_resume, monitor_delete
// -----------------------------------------------------------------------------

export const monitorIdParamsSchema = z.object({ monitor_id: monitorIdSchema });

export const monitorDeleteResultSchema = z.object({ ok: z.boolean() });
