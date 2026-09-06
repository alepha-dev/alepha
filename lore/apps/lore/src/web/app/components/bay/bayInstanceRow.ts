import type {
  EstateInventoryExpectedApp,
  EstateInventoryReportedApp,
  EstateInventoryResource,
} from "@/api/schemas/estateInventoryResourceSchema.ts";

/**
 * One row of the Apps table: something the machine reported, or something
 * Lore expected and did not get.
 *
 * The two arrays arrive already reconciled from the server (#Q1953), so this
 * merges them and never re-derives a match. Everything a row needs to render
 * is on it, which is what keeps the table from asking questions of two shapes.
 */
export type BayInstanceRow =
  | (EstateInventoryReportedApp & { reported: true })
  | (EstateInventoryExpectedApp & { reported: false });

/**
 * What the process is doing, as one word.
 *
 * ⚠️ `running: false` is NOT a status, which is the whole reason this exists.
 * A static site has no process and is healthy; `inactive` with the persisted
 * intent is a stop somebody owns; `inactive` without it is a process nobody
 * asked to stop; `failed` is a crash past its restart limit; `activating` is a
 * restart in flight. Collapsing the five into "down" is how a console reports
 * a healthy site as broken and a crash as a deliberate stop.
 */
export type BayProcessState =
  | "static"
  | "running"
  | "stopped"
  | "crashed"
  | "restarting"
  | "down"
  | "missing";

export const bayProcessState = (row: BayInstanceRow): BayProcessState => {
  if (!row.reported) {
    // Lore expects it here and the machine did not mention it at all. This is
    // what a failed deploy or a removed unit looks like from the outside, and
    // nothing else in Lore surfaces it.
    return "missing";
  }
  if (row.static) {
    return "static";
  }
  if (row.state === "activating") {
    return "restarting";
  }
  if (row.state === "failed") {
    return "crashed";
  }
  if (row.running) {
    return "running";
  }
  return row.stopped ? "stopped" : "down";
};

/**
 * The two arrays as one list.
 *
 * Sorted by memory descending, because the question a console is opened with
 * is which app is eating the box. Rows with no memory - a static site, a
 * stopped app, anything Lore-only - land after the measured ones, where they
 * belong under that question, and ties fall back to the pair so the order is
 * stable rather than whatever the arrays happened to hold.
 *
 * ⚠️ A comparator in memory, never a SQL sort, and never on the state: that is
 * a text enum, and sorting one sorts the label. Lore's board showed `optional`
 * above `high` for its whole life doing exactly that.
 */
export const bayInstanceRows = (
  data: EstateInventoryResource | undefined,
): BayInstanceRow[] => {
  if (!data) {
    return [];
  }
  const rows: BayInstanceRow[] = [
    ...(data.inventory?.apps ?? []).map(
      (app) => ({ ...app, reported: true }) as BayInstanceRow,
    ),
    ...data.expected.map(
      (app) => ({ ...app, reported: false }) as BayInstanceRow,
    ),
  ];
  return rows.sort((a, b) => {
    const left = a.reported ? (a.memoryBytes ?? -1) : -1;
    const right = b.reported ? (b.memoryBytes ?? -1) : -1;
    if (left !== right) {
      return right - left;
    }
    return `${a.app}/${a.env}`.localeCompare(`${b.app}/${b.env}`);
  });
};
