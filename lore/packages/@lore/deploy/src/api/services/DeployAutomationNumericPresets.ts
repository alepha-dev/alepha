import {
  AutomationCatalog,
  AutomationPresetRegistry,
  type AutomationPresetValues,
} from "@lore/core/api";
import type {
  AutomationPresetDescriptor,
  AutomationRule,
} from "@lore/core/schemas";
import { $inject } from "alepha";

import { DeployDashboardMetrics } from "./DeployDashboardMetrics.ts";
import { QualityNumericCatalog } from "./QualityNumericCatalog.ts";

/**
 * Stock scalar programs use the registered metric and guard contracts. They add
 * neither queries nor ingest hooks, and leave comparison state to the engine.
 */
export class DeployAutomationNumericPresets {
  protected readonly presets = $inject(AutomationPresetRegistry);
  protected readonly catalog = $inject(AutomationCatalog);
  // Ensure metadata is registered before deriving preset context and needs.
  protected readonly metrics = $inject(DeployDashboardMetrics);
  protected readonly quality = $inject(QualityNumericCatalog);
  constructor() {
    this.register(
      "coverage-regression",
      "Coverage regression",
      "Compare line coverage for the two fully closed UTC days at 00:10 UTC. Alert only when the drop exceeds the threshold in percentage points.",
      "quality.coverage.lines",
      "10 0 * * *",
      {
        threshold: { kind: "number", required: true, min: 0, max: 100 },
        branch: {
          kind: "text",
          required: true,
          default: "main",
          min: 1,
          max: 200,
        },
      },
      (values) => this.coverage(values),
    );
    this.register(
      "blight-crossing",
      "Open blights cross a threshold",
      "Sample aggregate open blights every five minutes. The first sample sets a baseline; falling to the threshold or below rearms the alert.",
      "openBlights",
      "*/5 * * * *",
      {
        threshold: { kind: "number", required: true, min: 0 },
      },
      (values) => this.blights(values),
    );
  }
  protected register(
    key: string,
    title: string,
    description: string,
    source: string,
    schedule: string,
    slots: AutomationPresetDescriptor["slots"],
    build: (values: AutomationPresetValues) => AutomationRule,
  ) {
    const entry = this.catalog.entries().find((entry) => entry.key === source)!;
    this.presets.register(
      {
        key,
        title,
        description,
        source,
        schedule,
        fields: entry.fields,
        needs: [{ capability: "work", option: "automations" }, ...entry.needs],
        permissions: ["automation:write", "member:read", ...entry.permissions],
        slots: {
          recipient: { kind: "member", required: true },
          channel: {
            kind: "channel",
            required: true,
            default: "inbox",
            values: ["inbox", "email"],
          },
          ...slots,
        },
      },
      build,
    );
  }
  protected notify(
    values: AutomationPresetValues,
    title: string,
    text: string,
  ): AutomationRule["actions"][number] {
    return {
      kind: "notify",
      recipient: String(values.recipient),
      channel: String(values.channel),
      title,
      text,
      category: "automations",
    };
  }
  protected coverage(values: AutomationPresetValues): AutomationRule {
    return {
      version: 1,
      trigger: { kind: "schedule", cron: "10 0 * * *" },
      select: {
        kind: "scalar",
        key: "quality.coverage.lines",
        filters: { branch: String(values.branch) },
      },
      guard: {
        field: "value",
        operator: "delta",
        value: Number(values.threshold),
      },
      actions: [
        this.notify(
          values,
          "Coverage regression: {{branch}}",
          `Line coverage regressed on {{branch}}.\n{{previous_day}}: {{previous}}%\n{{day}}: {{value}}%\nAlert threshold: ${Number(values.threshold)} percentage points.\n{{project}}`,
        ),
      ],
    };
  }
  protected blights(values: AutomationPresetValues): AutomationRule {
    return {
      version: 1,
      trigger: { kind: "schedule", cron: "*/5 * * * *" },
      select: {
        kind: "scalar",
        key: "openBlights",
        filters: { status: "open" },
      },
      guard: {
        field: "value",
        operator: "crossesAbove",
        value: Number(values.threshold),
      },
      actions: [
        this.notify(
          values,
          "Open blights crossed a threshold",
          `Open blights: {{value}}.\nCrossed above ${Number(values.threshold)}.\n{{project}}`,
        ),
      ],
    };
  }
}
