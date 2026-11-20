import { ProjectEventCatalog } from "@lore/core/api";
import { $inject } from "alepha";

/**
 * Build's project events (#E162): `coverage.dropped`, moved from Ship with
 * Quality, and gated by `build`.
 */
export class BuildProjectEvents {
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
      needs: { capability: "build", option: "quality" },
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
