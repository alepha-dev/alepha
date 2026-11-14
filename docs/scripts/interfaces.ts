/**
 * Which doc set a page belongs to, which is also its first URL segment: `""`
 * is the framework at `/docs/:slug`, `"bay"` is `/bay/docs/:slug`.
 *
 * ⚠️ A slug is unique only within a product. `guides-introduction` exists in
 * all three, so anything that names a file or a route by slug has to carry
 * the product beside it (quest #1603).
 */
export type DocProduct = "" | "bay" | "lore";

export type DocItem = {
  product: DocProduct;
  slug: string;
  name: string;
  description: string;
  content: string;
  originalContent: string;
  originalName: string;
  path: string;
  category: string;
  order: number;
  level: number;
  readingTime: number;
  lastModified: string | null;
  keywords: string[];
};

export type DocNode = {
  slug: string;
  name: string;
  order: number;
  children?: DocNode[];
  href?: string;
  description?: string;
  asset?: string; // file extension for assets (e.g., "txt"), uses window.location instead of router
  keywords?: string[];
};

export interface PrimitiveInfo {
  name: string;
  description: string;
}

export interface ModuleInfo {
  name: string; // "core", "server-swagger", "api-files", etc.
  exportKey: string; // ".", "./server/swagger", "./api/files", etc.
  sourcePath: string; // Path to the module's source directory
}

export interface EnvVarInfo {
  name: string; // e.g., "SERVER_PORT"
  type: string; // e.g., "integer", "text", "boolean"
  description?: string;
  default?: string;
  optional: boolean;
}

/**
 * One quest of a release, as the changelog page shows it (#Q3638).
 */
export interface ChangelogChange {
  scope: string; // the quest's area, as a module path: "orm", "api/users", "lore/quests"
  message: string; // the quest's title
}

/**
 * One section of a release: an epic, or the quests of one area that belong to
 * no epic. The same grouping as the Lore release it is read from.
 */
export interface ChangelogGroup {
  kind: "epic" | "area";
  name: string;
  changes: ChangelogChange[];
}

export interface ChangelogEntry {
  version: string; // e.g., "0.37.0"
  date: string; // the day the Lore release was published, e.g. "2026-11-10"
  groups: ChangelogGroup[];
}
