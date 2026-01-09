export type DocItem = {
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
