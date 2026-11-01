import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { ReportsQuery } from "../../../api/schemas/reportsQuerySchema.ts";
import type { ReportsUrl } from "../../../api/schemas/reportsUrlSchema.ts";
import { prioritySchema } from "../../../mcp/schemas/prioritySchema.ts";

/**
 * A filter of the Reports bar, as a tab declares the ones it honours.
 */
export type ReportsFilterKey =
  | "period"
  | "grain"
  | "compare"
  | "area"
  | "epicId"
  | "releaseId"
  | "tag"
  | "priority"
  | "memberId"
  | "branch";

/**
 * Turns the bar's page query into the query of a report action (#Q2996).
 *
 * Decoded here, one param at a time, because the URL is free text
 * (`reportsUrlSchema`): a value it refuses reads as absent, and a tab only ever
 * sees the filters it declares.
 */
export class ReportsUrlQuery {
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * The period a report opens on when the URL names none.
   */
  readonly defaultRange = "30d";

  readonly presets = ["7d", "30d", "90d", "6m", "1y", "all"] as const;

  /**
   * The query a tab honouring `filters` reads for this URL.
   */
  toQuery(url: ReportsUrl, filters: readonly ReportsFilterKey[]): ReportsQuery {
    const query: ReportsQuery = {};
    const honours = (key: ReportsFilterKey) => filters.includes(key);

    if (honours("period")) {
      Object.assign(query, this.period(url));
    }
    if (honours("grain") && this.isGrain(url.grain)) {
      query.grain = url.grain;
    }
    if (honours("compare") && url.compare === "true") {
      query.compare = true;
    }
    if (honours("area") && url.area) {
      query.area = url.area;
    }
    if (honours("tag") && url.tag) {
      query.tag = url.tag;
    }
    if (honours("epicId") && this.isId(url.epicId)) {
      query.epicId = Number(url.epicId);
    }
    if (honours("releaseId") && this.isId(url.releaseId)) {
      query.releaseId = Number(url.releaseId);
    }
    if (honours("priority")) {
      const priority = prioritySchema.safeParse(url.priority);
      if (priority.success) {
        query.priority = priority.data;
      }
    }
    if (honours("memberId") && url.memberId) {
      query.memberId = url.memberId;
    }
    if (honours("branch") && url.branch) {
      query.branch = url.branch;
    }
    return query;
  }

  /**
   * The URL after the bar changed `key`, with what that change invalidates
   * dropped, and an emptied param removed rather than left as `?area=`.
   *
   * Picking a preset forgets a custom range; picking a custom range says so.
   */
  patch(
    url: ReportsUrl,
    key: keyof ReportsUrl | "dates",
    value: string | boolean | string[] | undefined,
  ): Record<string, string> {
    const next: Record<string, string | undefined> = { ...url };
    if (key === "dates") {
      const [from, to] = Array.isArray(value) ? value : [];
      next.range = from && to ? "custom" : undefined;
      next.from = from;
      next.to = to;
    } else if (key === "range") {
      next.range = typeof value === "string" ? value : undefined;
      next.from = undefined;
      next.to = undefined;
    } else {
      next[key] =
        value === true ? "true" : typeof value === "string" ? value : undefined;
    }
    return Object.fromEntries(
      Object.entries(next).filter(
        (entry): entry is [string, string] => !!entry[1],
      ),
    );
  }

  /**
   * The bounds of the URL's period. A preset has no `to`: it runs up to now.
   */
  protected period(url: ReportsUrl): Pick<ReportsQuery, "from" | "to"> {
    if (url.range === "custom" && this.isDay(url.from) && this.isDay(url.to)) {
      return {
        from: `${url.from}T00:00:00.000Z`,
        to: `${url.to}T23:59:59.999Z`,
      };
    }
    const range = this.presets.find((it) => it === url.range);
    const preset = range ?? this.defaultRange;
    if (preset === "all") {
      return {};
    }
    const amount = Number.parseInt(preset, 10);
    const unit = preset.endsWith("m")
      ? "month"
      : preset.endsWith("y")
        ? "year"
        : "day";
    return { from: this.dt.now().subtract(amount, unit).toISOString() };
  }

  protected isGrain(
    value?: string,
  ): value is NonNullable<ReportsQuery["grain"]> {
    return value === "day" || value === "week" || value === "month";
  }

  protected isId(value?: string): boolean {
    return !!value && /^\d+$/.test(value);
  }

  protected isDay(value?: string): boolean {
    return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
}
