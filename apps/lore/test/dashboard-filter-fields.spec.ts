import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import { DashboardMetricCatalog } from "@/api/services/DashboardMetricCatalog.ts";
import { dashboardFilterFields } from "@/web/app/components/dashboard/dashboardFilterFields.ts";

/**
 * The Add-card wizard's filter step is generated from each metric's own Zod
 * schema, which is what makes adding a metric one registry entry rather than
 * a form. One value cannot be expressed that way and has to be handled
 * without naming a metric anywhere in the components: a project's quest tags
 * are ROWS, not a build-time enum.
 */
describe("dashboard filter fields", () => {
  let alepha: Alepha;
  let catalog: DashboardMetricCatalog;

  beforeEach(async () => {
    alepha = Alepha.create({ env: { LOG_LEVEL: "error", SERVER_PORT: 0 } });
    catalog = alepha.inject(DashboardMetricCatalog);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("emits a source-backed field for the tag, with its options left empty", ({
    expect,
  }) => {
    const metric = catalog.get("tagCompletion");
    const fields = dashboardFilterFields(metric.filters, metric.filterSources);

    // ⚠️ It survives the "fewer than two options is not a choice" filter that
    // drops every other empty field. Without that carve-out the tag card
    // would render with no control at all, and a card with no tag counts
    // nothing forever.
    expect(fields).toEqual([
      { name: "tag", options: [], multiple: false, source: "projectTags" },
    ]);
  });

  it("still reads an enum field off the schema, untouched", ({ expect }) => {
    const metric = catalog.get("activeQuests");
    const fields = dashboardFilterFields(metric.filters, metric.filterSources);

    expect(fields).toEqual([
      { name: "statuses", options: ["new", "accepted"], multiple: true },
    ]);
  });

  it("asks nothing for a metric with no filters", ({ expect }) => {
    const metric = catalog.get("epicProgress");

    expect(dashboardFilterFields(metric.filters, metric.filterSources)).toEqual(
      [],
    );
  });

  it("declares a source only where the schema genuinely cannot enumerate", ({
    expect,
  }) => {
    // A guard against the shortcut this mechanism exists to prevent: a metric
    // reaching for `filterSources` when a plain enum would do puts a value in
    // a component that belongs in a schema.
    const withSources = catalog
      .all()
      .filter((metric) => metric.filterSources)
      .map((metric) => metric.key);

    expect(withSources).toEqual(["tagCompletion"]);
  });
});
