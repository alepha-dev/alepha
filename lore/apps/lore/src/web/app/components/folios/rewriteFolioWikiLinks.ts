import type { Folio } from "@/api/entities/folios.ts";

/**
 * Flat folio-directory row used for path-style link resolution. Same
 * shape `DirectoryController.listAllDirectories` returns.
 */
export interface DirectoryRef {
  id: string;
  shortId: number;
  name: string;
  parentId?: string;
}

/**
 * Minimal blob shape needed to resolve `[[blob:#N]]` /
 * `[[blob:<uuid>]]` wiki-links and `![alt](blob:#N)` image embeds.
 * Pulled from `BlobController.listBlobs`
 * (the project-wide list `FolioBrowser` already fetches for the browser).
 */
export interface BlobRef {
  /** UUID — both PK and file id served at `/api/files/<uuid>`. */
  fileId: string;
  shortId: number;
  /** Display name in the folio tree (e.g. `diagram.png`). */
  name: string;
  /** MIME type from the framework `files` row. Drives image vs file render. */
  mime?: string;
  /** Byte size from the framework `files` row. Shown next to non-image links. */
  size?: number;
}

/** File extensions that render inline as `<img>` when referenced via `blob:`. */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
]);

const isImageBlob = (blob: BlobRef): boolean => {
  if (blob.mime?.startsWith("image/")) return true;
  const ext = blob.name.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Rewrite `[[...]]` wiki-link tokens in folio markdown into standard
 * markdown anchor syntax so the existing `<a>` renderer in MarkdownView
 * handles them. Mirrors the server-side `FolioLinkService` rules so what
 * gets displayed matches what gets persisted in `folio_links` —
 * out-of-sync resolution would lie to the reader.
 *
 * Supported forms:
 *
 *  - `[[#42]]` → folio shortId 42 in the same project.
 *  - `[[dir/sub/name]]` → folio `name` inside the directory chain
 *    `dir/sub`. Tries anchored-at-root first; falls back to unique
 *    suffix match (last directory name + folio name). Falls back to
 *    title match when both fail (useful for slash-bearing titles).
 *  - `[[Folio Title]]` → folio by title (case-insensitive, ambiguous
 *    titles fall back to literal text).
 *  - `[[#42#zones]]` / `[[Folio Title#zones]]` → folio + heading slug.
 *  - `[[quest#32]]` → quest shortId 32 in the same project.
 *  - `[[quest:Some Title]]` → quest by title (resolved if a quest list
 *    is supplied; otherwise rendered as plain text).
 *
 * Unresolved references render as a "broken link" marker — a real
 * markdown link with a synthetic `lore-broken:<reason>` href that the
 * hover-preview wrapper styles distinctly and explains on hover (#107).
 * Reasons: `folio-not-found`, `ambiguous-title`, `quest-not-found`,
 * `blob-not-found`. The original `[[...]]` text is preserved as the
 * label so the author still sees what they typed.
 */
export const BROKEN_HREF_PREFIX = "lore-broken:";

/** Build the broken-link marker for one of the documented reasons. */
const broken = (
  originalBody: string,
  reason:
    | "folio-not-found"
    | "ambiguous-title"
    | "quest-not-found"
    | "blob-not-found",
): string => {
  const label = escapeMarkdownLabel(`[[${originalBody}]]`);
  return `[${label}](${BROKEN_HREF_PREFIX}${reason})`;
};

export const rewriteFolioWikiLinks = (
  content: string,
  projectId: number,
  folios: Folio[],
  quests: Array<{ shortId: number; title: string }>,
  directories: DirectoryRef[] = [],
  blobs: BlobRef[] = [],
): string => {
  if (!content) return content;
  const hasWiki = content.includes("[[");
  const hasBlobImage = /!\[[^\]]*\]\(blob:/i.test(content);
  if (!hasWiki && !hasBlobImage) return content;

  const folioByShort = new Map<number, Folio>();
  const folioByTitle = new Map<string, { folio: Folio; count: number }>();
  for (const f of folios) {
    folioByShort.set(f.shortId, f);
    const key = f.title.toLowerCase().trim();
    const existing = folioByTitle.get(key);
    if (existing) existing.count++;
    else folioByTitle.set(key, { folio: f, count: 1 });
  }

  const questByShort = new Map<number, { shortId: number; title: string }>();
  const questByTitle = new Map<
    string,
    { quest: { shortId: number; title: string }; count: number }
  >();
  for (const q of quests) {
    questByShort.set(q.shortId, q);
    const key = q.title.toLowerCase().trim();
    const existing = questByTitle.get(key);
    if (existing) existing.count++;
    else questByTitle.set(key, { quest: q, count: 1 });
  }

  // Build the path-resolution lookups only when at least one token
  // contains a `/` (the same lazy pattern the server uses).
  const needsPaths = /\[\[[^\]\n]*\/[^\]\n]+\]\]/.test(content);
  const pathCtx = needsPaths ? buildPathContext(folios, directories) : null;

  // Blob lookups — by shortId and by UUID. No title map: blob names
  // aren't unique within a project (only within a parent directory).
  const blobByShort = new Map<number, BlobRef>();
  const blobByUuid = new Map<string, BlobRef>();
  for (const b of blobs) {
    blobByShort.set(b.shortId, b);
    blobByUuid.set(b.fileId, b);
  }

  // Step 1 — rewrite `![alt](blob:#42)` / `![alt](blob:<uuid>)` image
  // syntax BEFORE the wiki-link pass. Image MIME → `<img>` URL.
  // Non-image MIME → a plain link with a paperclip + size annotation
  // (so non-image blobs degrade to a download link instead of a
  // broken-image placeholder).
  const rewritten = content.replace(
    /!\[([^\]]*)\]\(blob:([^)\s]+)\)/gi,
    (full, alt: string, ref: string) => {
      const blob = resolveBlobRef(ref, blobByShort, blobByUuid);
      if (!blob) return full;
      const fileUrl = `/api/files/${blob.fileId}`;
      if (isImageBlob(blob)) {
        const safeAlt = alt || blob.name;
        return `![${safeAlt}](${fileUrl})`;
      }
      const sizeSuffix =
        blob.size != null ? ` (${formatBytes(blob.size)})` : "";
      const label = escapeMarkdownLabel(`📎 ${blob.name}${sizeSuffix}`);
      return `[${label}](${fileUrl})`;
    },
  );

  if (!hasWiki) return rewritten;

  return rewritten.replace(/\[\[([^\]\n]+)\]\]/g, (_full, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return `[[${body}]]`;

    // Type prefix (folio | quest | blob). Bare token = folio.
    let type: "folio" | "quest" | "blob" = "folio";
    let rest = trimmed;
    const colonIdx = rest.indexOf(":");
    if (colonIdx > 0) {
      const prefix = rest.slice(0, colonIdx).trim().toLowerCase();
      if (prefix === "quest" || prefix === "folio" || prefix === "blob") {
        type = prefix;
        rest = rest.slice(colonIdx + 1).trim();
      }
    }

    // Anchors are folio-only for v1 (matches the server parser).
    let anchor = "";
    if (type === "folio") {
      if (rest.startsWith("#")) {
        const second = rest.indexOf("#", 1);
        if (second !== -1) {
          anchor = rest.slice(second + 1).trim();
          rest = rest.slice(0, second);
        }
      } else {
        const hashIdx = rest.indexOf("#");
        if (hashIdx !== -1) {
          anchor = rest.slice(hashIdx + 1).trim();
          rest = rest.slice(0, hashIdx).trim();
        }
      }
    }

    if (type === "blob") {
      const blob = resolveBlobRef(rest, blobByShort, blobByUuid);
      if (!blob) return broken(body, "blob-not-found");
      const href = `/api/files/${blob.fileId}`;
      const label = escapeMarkdownLabel(blob.name);
      return `[${label}](${href})`;
    }

    if (type === "quest") {
      let quest: { shortId: number; title: string } | undefined;
      let questAmbiguous = false;
      if (rest.startsWith("#")) {
        const n = Number.parseInt(rest.slice(1), 10);
        quest = Number.isFinite(n) ? questByShort.get(n) : undefined;
      } else {
        const hit = questByTitle.get(rest.toLowerCase().trim());
        if (hit && hit.count === 1) quest = hit.quest;
        else if (hit && hit.count > 1) questAmbiguous = true;
      }
      if (!quest) {
        return broken(
          body,
          questAmbiguous ? "ambiguous-title" : "quest-not-found",
        );
      }
      const href = `/p/${projectId}/q/${quest.shortId}`;
      const label = escapeMarkdownLabel(quest.title);
      return `[${label}](${href})`;
    }

    // Folio.
    let folio: Folio | undefined;
    let pathLabel: string | undefined;
    if (rest.startsWith("#")) {
      const n = Number.parseInt(rest.slice(1), 10);
      folio = Number.isFinite(n) ? folioByShort.get(n) : undefined;
    } else if (pathCtx && rest.includes("/")) {
      const pathHit = resolvePathToken(rest, pathCtx);
      if (pathHit) {
        folio = folioByShort.get(pathHit.shortId);
        // Keep the token verbatim as the display label so the reader
        // sees the same path they typed — bare folio titles ("admin",
        // "roadmap") repeat across buckets and need the path to read.
        pathLabel = rest;
      }
    }
    let folioAmbiguous = false;
    if (!folio) {
      const hit = folioByTitle.get(rest.toLowerCase().trim());
      if (hit && hit.count === 1) folio = hit.folio;
      else if (hit && hit.count > 1) folioAmbiguous = true;
    }
    if (!folio) {
      return broken(
        body,
        folioAmbiguous ? "ambiguous-title" : "folio-not-found",
      );
    }
    // Folio detail lives under `/folios/:shortId` — keep this in sync
    // with AppRouter.
    const href = anchor
      ? `/p/${projectId}/folios/${folio.shortId}#${slugify(anchor)}`
      : `/p/${projectId}/folios/${folio.shortId}`;
    const labelText =
      (pathLabel ?? folio.title) + (anchor ? ` § ${anchor}` : "");
    const label = escapeMarkdownLabel(labelText);
    return `[${label}](${href})`;
  });
};

/**
 * Pre-built lookup structures matching the server-side `PathContext` in
 * `FolioLinkService`. See that file's docstring for the resolution rules.
 */
interface PathContext {
  childrenByParent: Map<string, Map<string, { id: string; count: number }>>;
  foliosByDir: Map<string, Map<string, { shortId: number; count: number }>>;
  dirNameById: Map<string, string>;
  dirParentById: Map<string, string | null>;
}

const ROOT_DIR = "root";

const buildPathContext = (
  folios: Folio[],
  directories: DirectoryRef[],
): PathContext => {
  const ctx: PathContext = {
    childrenByParent: new Map(),
    foliosByDir: new Map(),
    dirNameById: new Map(),
    dirParentById: new Map(),
  };
  for (const d of directories) {
    ctx.dirNameById.set(d.id, d.name);
    ctx.dirParentById.set(d.id, d.parentId ?? null);
    const parentKey = d.parentId ?? ROOT_DIR;
    let bucket = ctx.childrenByParent.get(parentKey);
    if (!bucket) {
      bucket = new Map();
      ctx.childrenByParent.set(parentKey, bucket);
    }
    const nameKey = d.name.toLowerCase().trim();
    const entry = bucket.get(nameKey);
    if (entry) entry.count++;
    else bucket.set(nameKey, { id: d.id, count: 1 });
  }
  for (const f of folios) {
    const dirKey = f.directoryId ?? ROOT_DIR;
    let inDir = ctx.foliosByDir.get(dirKey);
    if (!inDir) {
      inDir = new Map();
      ctx.foliosByDir.set(dirKey, inDir);
    }
    const titleKey = f.title.toLowerCase().trim();
    const entry = inDir.get(titleKey);
    if (entry) entry.count++;
    else inDir.set(titleKey, { shortId: f.shortId, count: 1 });
  }
  return ctx;
};

/**
 * Two-pass match (anchored-at-root, then unique suffix). Mirrors
 * `FolioLinkService.resolvePathToken`. Returns the matched folio's
 * shortId or `undefined`.
 */
const resolvePathToken = (
  ref: string,
  ctx: PathContext,
): { shortId: number } | undefined => {
  const segments = ref
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length < 2) return undefined;
  const nameKey = segments[segments.length - 1].toLowerCase();
  const dirSegments = segments.slice(0, -1).map((s) => s.toLowerCase());

  // Pass 1 — anchored at root.
  const anchored = walkPath(dirSegments, ROOT_DIR, ctx);
  if (anchored) {
    const folioHit = ctx.foliosByDir.get(anchored)?.get(nameKey);
    if (folioHit && folioHit.count === 1) return { shortId: folioHit.shortId };
  }

  // Pass 2 — suffix match.
  const candidates: number[] = [];
  for (const [dirId, dirName] of ctx.dirNameById) {
    if (dirName.toLowerCase().trim() !== dirSegments[dirSegments.length - 1]) {
      continue;
    }
    if (!chainEndsWith(dirId, dirSegments, ctx)) continue;
    const folioHit = ctx.foliosByDir.get(dirId)?.get(nameKey);
    if (folioHit && folioHit.count === 1) candidates.push(folioHit.shortId);
  }
  const unique = Array.from(new Set(candidates));
  return unique.length === 1 ? { shortId: unique[0] } : undefined;
};

const walkPath = (
  segments: string[],
  startDirId: string,
  ctx: PathContext,
): string | undefined => {
  let current = startDirId;
  for (const seg of segments) {
    const children = ctx.childrenByParent.get(current);
    if (!children) return undefined;
    const child = children.get(seg);
    if (!child || child.count > 1) return undefined;
    current = child.id;
  }
  return current;
};

const chainEndsWith = (
  dirId: string,
  segments: string[],
  ctx: PathContext,
): boolean => {
  let cursor: string | null = dirId;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!cursor) return false;
    const name = ctx.dirNameById.get(cursor);
    if (!name || name.toLowerCase().trim() !== segments[i]) return false;
    cursor = ctx.dirParentById.get(cursor) ?? null;
  }
  return true;
};

/**
 * Match the slug a typical markdown→HTML pipeline produces for a heading.
 * Lowercase, strip non-word chars (except hyphens), collapse whitespace
 * to dashes. The exact rule doesn't have to match `rehype-slug` perfectly
 * for v1 — the user can fall back to the folio root if the anchor misses.
 */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Escape characters that would break a markdown link label. Brackets are
 * the main concern; titles with literal `]` would terminate the label
 * early and leave the URL on the page as text.
 */
const escapeMarkdownLabel = (s: string): string =>
  s.replace(/[\\[\]]/g, (c) => `\\${c}`);

/**
 * Resolve a blob ref token (`#42` for shortId, anything else for UUID)
 * against the precomputed maps. Returns `undefined` when nothing
 * matches — caller renders the original `[[...]]` / `![...]` literally
 * so the author can see the broken reference.
 */
const resolveBlobRef = (
  ref: string,
  byShort: Map<number, BlobRef>,
  byUuid: Map<string, BlobRef>,
): BlobRef | undefined => {
  const trimmed = ref.trim();
  if (trimmed.startsWith("#")) {
    const n = Number.parseInt(trimmed.slice(1), 10);
    return Number.isFinite(n) ? byShort.get(n) : undefined;
  }
  return byUuid.get(trimmed);
};
