import type { DateTimeProvider } from "alepha/datetime";

import {
  activityAgeInDays,
  HOME_INACTIVE_AFTER_DAYS,
} from "./homeActivityAge.ts";

/**
 * The Home table's filter bar, as the predicate reads it.
 */
export interface HomeProjectsFilters {
  search?: string;
  ownership?: "owned" | "notOwned";
  activity?: "active" | "dormant";
}

/**
 * What the predicate needs of one row.
 */
export interface HomeProjectsFilterRow {
  title: string;
  owner: boolean;
  updatedAt: string;
}

/**
 * Whether a project reads as dormant: no activity for
 * {@link HOME_INACTIVE_AFTER_DAYS} days, the same week that mutes a row, so
 * "Dormant" selects the rows the page already dims.
 *
 * `lastActivity` is the board's value, absent until the board arrives. The
 * filter has to answer before then, so it falls back to the project row's own
 * `updatedAt`, as the Last activity sort does. The board's value is never
 * earlier than that one (the server takes the later of the two), so the
 * fallback can only call a project dormant too early, and the row moves once
 * the board lands.
 */
export const isHomeProjectDormant = (
  dt: DateTimeProvider,
  project: HomeProjectsFilterRow,
  lastActivity: string | undefined,
): boolean =>
  activityAgeInDays(dt, lastActivity ?? project.updatedAt) >=
  HOME_INACTIVE_AFTER_DAYS;

/**
 * Whether one row passes the Home table's filter bar. An empty filter lets
 * everything through, so clearing one is "all".
 */
export const homeProjectMatches = (
  dt: DateTimeProvider,
  project: HomeProjectsFilterRow,
  filters: HomeProjectsFilters,
  lastActivity: string | undefined,
): boolean => {
  if (filters.ownership && project.owner !== (filters.ownership === "owned")) {
    return false;
  }
  if (
    filters.activity &&
    isHomeProjectDormant(dt, project, lastActivity) !==
      (filters.activity === "dormant")
  ) {
    return false;
  }
  return (
    !filters.search ||
    project.title.toLowerCase().includes(filters.search.toLowerCase())
  );
};
