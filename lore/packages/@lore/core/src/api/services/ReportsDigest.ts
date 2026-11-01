import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { ReportsSummaryLine } from "../schemas/reportsSummarySchema.ts";
import {
  AutomationCollections,
  type AutomationCollectionFormatInput,
} from "./AutomationCollections.ts";
import {
  AutomationSelections,
  type AutomationSelectionPage,
} from "./AutomationSelections.ts";
import { ReportsSummaryRegistry } from "./ReportsSummaryRegistry.ts";

/**
 * The Summary tab's last seven days as an automation source (#Q3018): the
 * weekly digest is a preset over this, never a scheduler of its own.
 *
 * The labels are English like every other notification body here: an account
 * has no language, and the digest is rendered once on the server.
 */
export class ReportsDigest {
  protected readonly summary = $inject(ReportsSummaryRegistry);
  protected readonly selections = $inject(AutomationSelections);
  protected readonly collections = $inject(AutomationCollections);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * What each line reads as. A key missing here prints as itself.
   */
  protected readonly labels: Record<string, string> = {
    throughput: "Quests completed",
    cycleTime: "Cycle time",
    wip: "In progress",
    epicsShipped: "Epics completed",
    releasesShipped: "Releases published",
    feedbackIn: "Feedback received",
    feedbackTriaged: "Feedback triaged",
    feedbackPending: "Feedback pending",
    foliosCreated: "Folios created",
    foliosRevised: "Folio revisions",
    deploys: "Deploys",
    deploySuccess: "Deploy success",
    openBlights: "Open blights",
    uptime: "Uptime",
    coverage: "Coverage",
  };

  constructor() {
    this.selections.register("reports.summary", {
      select: ({ projectId, evaluatedAt }) => this.read(projectId, evaluatedAt),
    });
    this.collections.register("reports.summary", (input) => this.text(input));
  }

  public async read(
    projectId: number,
    evaluatedAt: string,
  ): Promise<AutomationSelectionPage> {
    const lines = await this.summary.lines(projectId, {
      from: this.dt.of(evaluatedAt).subtract(7, "day").toISOString(),
      to: evaluatedAt,
    });
    return {
      items: lines.map((line) => ({
        key: line.key,
        value: this.figure(line, line.value),
        previous:
          line.previous === undefined ? "" : this.figure(line, line.previous),
      })),
      total: lines.length,
      totalIsExact: true,
      hasMore: false,
    };
  }

  public text(input: AutomationCollectionFormatInput): string {
    return [
      "The last seven days, against the seven before.",
      ...input.items.map((item) => {
        const label = this.labels[String(item.key)] ?? String(item.key);
        return `${label}: ${item.value}${item.previous ? ` (was ${item.previous})` : ""}`;
      }),
    ].join("\n");
  }

  protected figure(line: ReportsSummaryLine, value: number): string {
    if (line.format === "percent") {
      return `${Math.round(value * 10) / 10}%`;
    }
    if (line.format === "hours") {
      return value >= 48
        ? `${Math.round(value / 24)}d`
        : `${Math.round(value)}h`;
    }
    return String(Math.round(value));
  }
}
