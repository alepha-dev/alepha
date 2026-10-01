/**
 * Which doc set a page belongs to, which is also its first URL segment: `""`
 * is the framework at `/docs/:slug`, and another product `p` would live at
 * `/p/docs/:slug`.
 *
 * The framework is the only doc set now. Bay and Lore had theirs here until
 * they left this repository (#E72), and the product dimension stays so that a
 * second doc set costs a root and a route rather than a refactor.
 *
 * ⚠️ A slug is unique only within a product, so anything that names a file or
 * a route by slug carries the product beside it (quest #1603).
 */
export type DocProduct = "";

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

export interface ChangelogChange {
  scope: string; // e.g., "cli", "server", "vite"
  message: string; // The change description
  commit?: string; // Optional commit hash
}

export interface ChangelogEntry {
  version: string; // e.g., "0.14.3"
  date: string; // e.g., "2026-01-08"
  features: ChangelogChange[];
  fixes: ChangelogChange[];
}
