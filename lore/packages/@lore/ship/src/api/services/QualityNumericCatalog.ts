import { DashboardMetricCatalog } from "@lore/core/schemas";
import { $inject } from "alepha";

import { qualityNumericFiltersSchema } from "../schemas/qualityNumericFiltersSchema.ts";

/**
 * Explicit numeric opt-ins. Coverage remains a decimal scalar, not a progress
 * object. Every number describes yesterday on exactly one branch.
 */
export class QualityNumericCatalog {
  protected readonly catalog = $inject(DashboardMetricCatalog);

  public static readonly metrics = {
    "quality.coverage.lines": {
      column: "coverageLines",
      labelKey: "dashboard.metric.quality.coverage.lines",
      hintKey: "dashboard.metric.quality.coverage.lines.hint",
    },
    "quality.coverage.statements": {
      column: "coverageStatements",
      labelKey: "dashboard.metric.quality.coverage.statements",
      hintKey: "dashboard.metric.quality.coverage.statements.hint",
    },
    "quality.coverage.functions": {
      column: "coverageFunctions",
      labelKey: "dashboard.metric.quality.coverage.functions",
      hintKey: "dashboard.metric.quality.coverage.functions.hint",
    },
    "quality.coverage.branches": {
      column: "coverageBranches",
      labelKey: "dashboard.metric.quality.coverage.branches",
      hintKey: "dashboard.metric.quality.coverage.branches.hint",
    },
    "quality.tests.total": {
      column: "testsTotal",
      labelKey: "dashboard.metric.quality.tests.total",
      hintKey: "dashboard.metric.quality.tests.total.hint",
    },
    "quality.tests.passed": {
      column: "testsPassed",
      labelKey: "dashboard.metric.quality.tests.passed",
      hintKey: "dashboard.metric.quality.tests.passed.hint",
    },
    "quality.tests.failed": {
      column: "testsFailed",
      labelKey: "dashboard.metric.quality.tests.failed",
      hintKey: "dashboard.metric.quality.tests.failed.hint",
    },
    "quality.tests.skipped": {
      column: "testsSkipped",
      labelKey: "dashboard.metric.quality.tests.skipped",
      hintKey: "dashboard.metric.quality.tests.skipped.hint",
    },
  } as const;

  constructor() {
    for (const [index, [key, metadata]] of Object.entries(
      QualityNumericCatalog.metrics,
    ).entries()) {
      this.catalog.register({
        key,
        boards: ["project"],
        scopeKinds: ["projects"],
        group: "apps",
        order: 84 + index,
        labelKey: metadata.labelKey,
        hintKey: metadata.hintKey,
        icon: "shield-check",
        presentation: "scalar",
        filters: qualityNumericFiltersSchema,
        requires: "quality:read",
        needs: { capability: "apps" },
        automation: {
          kind: "number",
          requires: "quality:read",
          slots: {
            branch: {
              kind: "text",
              required: false,
              default: "main",
              max: 200,
            },
          },
          fields: {
            branch: "text",
            day: "text",
            previous_day: "text",
            commit_sha: "text",
            previous_commit_sha: "text",
            updated_at: "text",
            previous_updated_at: "text",
            previous: "number",
          },
          operators: [
            "eq",
            "ne",
            "lt",
            "lte",
            "gt",
            "gte",
            "crossesAbove",
            ...(key.startsWith("quality.coverage.") ? ["delta" as const] : []),
          ],
        },
        link: (_scope, target) =>
          target.projectSlug
            ? {
                route: "reportsQuality",
                params: { projectSlug: target.projectSlug },
              }
            : undefined,
      });
    }
  }
}
