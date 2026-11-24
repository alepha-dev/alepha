import { $inject } from "alepha";

import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";

/**
 * Quality's project events (#E162, core's since #Q4217): `coverage.dropped`,
 * gated by Reports' `quality` option.
 */
export class QualityProjectEvents {
  protected readonly catalog = $inject(ProjectEventCatalog);

  constructor() {
    this.catalog.register({
      name: "coverage.dropped",
      label: "Coverage under its threshold",
      resource: "quality",
      subject: "commit",
      fields: {
        value: "number",
        previous: "number",
        threshold: "number",
        branch: "text",
        commit: "text",
      },
      needs: { capability: "reports", option: "quality" },
      permission: "quality:read",
      message: (it) => ({
        title: `Line coverage dropped to ${this.percent(it.value)}`,
        text: `Under the ${this.percent(it.threshold)} threshold on ${this.text(it.branch)}${it.previous === null || it.previous === undefined ? "" : `, from ${this.percent(it.previous)}`}.`,
      }),
    });
  }

  protected text(value: string | number | boolean | null | undefined): string {
    return value === null || value === undefined ? "" : String(value);
  }

  protected percent(
    value: string | number | boolean | null | undefined,
  ): string {
    return typeof value === "number" ? `${Math.round(value * 10) / 10}%` : "";
  }
}
