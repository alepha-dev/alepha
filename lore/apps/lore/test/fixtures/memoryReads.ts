/**
 * A custom rank that reads the project's memory and nothing else: quests,
 * epics, releases, areas, folios and Plan's Requirements.
 *
 * The specs that prove each surface answers from the reader's permissions,
 * never from membership, seat someone on it: it holds `project:read`, the
 * floor, and none of `member:read`, `feedback:read`, `app:read` or
 * `error:read`. It was the Viewer preset while public projects existed;
 * Viewer is every `:read` since #Q3833.
 */
export const MEMORY_READS: string[] = [
  "project",
  "quest",
  "epic",
  "release",
  "area",
  "folio",
  "persona",
  "usecase",
  "requirement",
].map((group) => `${group}:read`);
