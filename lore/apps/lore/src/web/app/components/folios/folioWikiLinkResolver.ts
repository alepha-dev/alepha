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
 * Pulled from `BlobController.listBlobs` / `listAllBlobs`.
 */
export interface BlobRef {
  /**
   * UUID — both PK and file id served at `/api/files/<uuid>`.
   */
  fileId: string;
  shortId: number;
  /**
   * Display name in the folio tree (e.g. `diagram.png`).
   */
  name: string;
  /**
   * MIME type from the framework `files` row. Drives image vs file render.
   */
  mime?: string;
  /**
   * Byte size from the framework `files` row. Shown next to non-image links.
   */
  size?: number;
}

export interface QuestRef {
  shortId: number;
  title: string;
}

/**
 * An epic, keyed by the per-project `number` it is addressed by. Named
 * `shortId` to match {@link QuestRef} so one map-building shape serves both
 * — epics have no `shortId` column of their own.
 */
export interface EpicRef {
  shortId: number;
  title: string;
}

export type BrokenWikiLinkReason =
  | "folio-not-found"
  | "ambiguous-title"
  | "quest-not-found"
  | "epic-not-found"
  | "blob-not-found"
  /**
   * `[[#N]]` matched no folio, but quest #N exists — almost certainly a quest
   * reference written in the folio form.
   *
   * Kept as its own reason rather than resolving to the quest, because
   * inferring across entity types is worse than the broken link it would
   * replace: `[[#42]]` is unambiguous today, and making it mean "folio 42, or
   * quest 42 if that folio is missing" would make a link's destination depend
   * on which folios happen to exist — so deleting an unrelated folio could
   * silently repoint a link somewhere else entirely.
   *
   * The mistake is predictable enough to be worth naming: quests are shown as
   * `#156` everywhere in the product, and only inside `[[…]]` does `#N` mean a
   * folio. The editor's `[[` typeahead already prevents it by offering quests
   * and inserting `quest:#N` — but MCP clients write markdown directly and
   * never see that typeahead, which is how the references that prompted this
   * were authored in the first place.
   */
  | "folio-not-found-quest-exists";

/**
 * Synthetic href for a reference that resolved to nothing. It is not a URL
 * anybody navigates to — the reader-side hover card and the editor's own
 * click handler both recognise the prefix and explain the failure instead of
 * following it (#107).
 *
 * ⚠️ The leading `#` is load-bearing, and this used to be a bare
 * `lore-broken:` scheme. react-markdown runs every href through
 * `defaultUrlTransform`, which drops any scheme outside its safe list — so
 * every broken link reached the DOM as `href=""` and NONE of the machinery
 * downstream of it ever ran: not the wavy red underline keyed on the prefix,
 * not the hover card explaining the reason, not the localised messages in
 * both catalogues. A fragment is a relative URL, so the transform keeps it
 * verbatim, colons and all. Anything that replaces this must survive that
 * transform; a custom scheme cannot without a change to `MarkdownView`.
 */
export const BROKEN_HREF_PREFIX = "#lore-broken:";

/**
 * What one `[[...]]` token points at.
 *
 * `href` is always populated, including for `broken` — carrying the reason
 * in the href is what lets a rewritten markdown document keep the diagnosis
 * through a renderer that only understands links.
 */
export type WikiLinkTarget =
  | { kind: "folio"; href: string; label: string }
  | { kind: "quest"; href: string; label: string }
  | { kind: "epic"; href: string; label: string }
  | { kind: "blob"; href: string; label: string }
  | {
      kind: "broken";
      href: string;
      label: string;
      reason: BrokenWikiLinkReason;
    };

export interface FolioWikiLinkResolverInput {
  projectSlug: string;
  folios: Folio[];
  quests: QuestRef[];
  /**
   * Optional so a caller that never renders epic refs (or predates them)
   * keeps working — an `[[epic:…]]` then resolves to `epic-not-found`
   * rather than throwing, which is the same outcome as a real miss.
   */
  epics?: EpicRef[];
  directories?: DirectoryRef[];
  blobs?: BlobRef[];
}

export interface FolioWikiLinkResolver {
  /**
   * Resolve the INNER text of a token — `"#42"`, `"quest#7"`, `"Some Title"` —
   * without the surrounding brackets. Returns `undefined` only for a token
   * that is entirely blank, which is not a reference at all and should be
   * left exactly as the author typed it.
   */
  resolve: (body: string) => WikiLinkTarget | undefined;
  /**
   * Resolve a `blob:` embed target (`#42` or a uuid) to its row.
   */
  resolveBlob: (ref: string) => BlobRef | undefined;
  /**
   * Resolve the `<name>` half of an `assets/<name>` path to its row.
   *
   * This is the form folio markdown actually stores, and the reason it is by
   * name rather than by id: the stored document is also the EXPORTED
   * document, so `assets/photo.webp` has to mean something once unzipped
   * next to an `assets/` folder, with no Lore to resolve it.
   */
  resolveBlobByName: (name: string) => BlobRef | undefined;
}

/**
 * File extensions that render inline as `<img>` when referenced via `blob:`.
 */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
]);

export const isImageBlob = (blob: BlobRef): boolean => {
  if (blob.mime?.startsWith("image/")) return true;
  const ext = blob.name.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
};

export const formatBlobBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Build a reusable resolver over one project's folios / quests / directories
 * / blobs.
 *
 * The lookup maps are built once per resolver, not once per token: a folio
 * body with fifty references would otherwise rebuild them fifty times, and
 * the Lexical editor plugin resolves a token on every keystroke inside it.
 *
 * The rules mirror the server-side `FolioLinkService` exactly, because what
 * the reader sees resolved and what gets persisted in `folio_links` have to
 * agree — a resolver that drifted from the server would show a live link for
 * an edge the graph does not have (or the reverse).
 *
 * Supported forms:
 *
 *  - `[[#42]]` → folio shortId 42 in the same project.
 *  - `[[dir/sub/name]]` → folio `name` inside the directory chain `dir/sub`.
 *    Tries anchored-at-root first; falls back to unique suffix match (last
 *    directory name + folio name). Falls back to title match when both fail
 *    (useful for slash-bearing titles).
 *  - `[[Folio Title]]` → folio by title (case-insensitive, ambiguous titles
 *    resolve to `broken: ambiguous-title`).
 *  - `[[#42#areas]]` / `[[Folio Title#areas]]` → folio + heading slug.
 *  - `[[quest:#32]]` / `[[quest:Some Title]]` → quest in the same project.
 *    The colon is what selects the type, so the colon-less `[[quest#32]]` is
 *    NOT a quest reference: it reads as a folio titled `quest` with the
 *    anchor `32`, and breaks.
 *  - `[[blob:#3]]` / `[[blob:<uuid>]]` → an uploaded file.
 */
export const createFolioWikiLinkResolver = (
  input: FolioWikiLinkResolverInput,
): FolioWikiLinkResolver => {
  const { projectSlug, folios, quests } = input;
  const epics = input.epics ?? [];
  const directories = input.directories ?? [];
  const blobs = input.blobs ?? [];

  const folioByShort = new Map<number, Folio>();
  const folioByTitle = new Map<string, { folio: Folio; count: number }>();
  for (const f of folios) {
    folioByShort.set(f.shortId, f);
    const key = f.title.toLowerCase().trim();
    const existing = folioByTitle.get(key);
    if (existing) existing.count++;
    else folioByTitle.set(key, { folio: f, count: 1 });
  }

  const questByShort = new Map<number, QuestRef>();
  const questByTitle = new Map<string, { quest: QuestRef; count: number }>();
  for (const q of quests) {
    questByShort.set(q.shortId, q);
    const key = q.title.toLowerCase().trim();
    const existing = questByTitle.get(key);
    if (existing) existing.count++;
    else questByTitle.set(key, { quest: q, count: 1 });
  }

  const epicByNumber = new Map<number, EpicRef>();
  const epicByTitle = new Map<string, { epic: EpicRef; count: number }>();
  for (const e of epics) {
    epicByNumber.set(e.shortId, e);
    const key = e.title.toLowerCase().trim();
    const existing = epicByTitle.get(key);
    if (existing) existing.count++;
    else epicByTitle.set(key, { epic: e, count: 1 });
  }

  const blobByShort = new Map<number, BlobRef>();
  const blobByUuid = new Map<string, BlobRef>();
  for (const b of blobs) {
    blobByShort.set(b.shortId, b);
    blobByUuid.set(b.fileId, b);
  }

  // Built lazily: a project with no directories, or a document with no
  // path-shaped token, never pays for it.
  let pathCtx: PathContext | undefined;
  const paths = (): PathContext => {
    pathCtx ??= buildPathContext(folios, directories);
    return pathCtx;
  };

  const resolveBlob = (ref: string): BlobRef | undefined => {
    const trimmed = ref.trim();
    if (trimmed.startsWith("#")) {
      const n = Number.parseInt(trimmed.slice(1), 10);
      return Number.isFinite(n) ? blobByShort.get(n) : undefined;
    }
    return blobByUuid.get(trimmed);
  };

  /**
   * Built lazily and only for `assets/` references, so a document with none
   * never pays for it. Case-insensitive because `FolioBlobService` enforces
   * uniqueness case-insensitively too — `Photo.webp` and `photo.webp` cannot
   * both exist on one folio, so folding the key cannot introduce ambiguity.
   */
  let blobByName: Map<string, BlobRef> | undefined;
  const resolveBlobByName = (name: string): BlobRef | undefined => {
    blobByName ??= new Map(
      (blobs ?? []).map((blob) => [blob.name.trim().toLowerCase(), blob]),
    );
    return blobByName.get(name.trim().toLowerCase());
  };

  /**
   * `hint` is appended to the href after a colon (reasons never contain one)
   * so a diagnosis can carry a value the message needs — currently the quest
   * shortId behind `folio-not-found-quest-exists`.
   *
   * It rides in the href for the same reason the reason does: a rewritten
   * markdown document passes through a renderer that understands links and
   * nothing else, so anything the hover card needs has to survive as part of
   * the URL. Reading it back off the rendered label would work today and break
   * the moment the label's format changes.
   */
  const brokenTarget = (
    body: string,
    reason: BrokenWikiLinkReason,
    hint?: string | number,
  ): WikiLinkTarget => ({
    kind: "broken",
    href:
      hint == null
        ? `${BROKEN_HREF_PREFIX}${reason}`
        : `${BROKEN_HREF_PREFIX}${reason}:${hint}`,
    label: `[[${body}]]`,
    reason,
  });

  const resolve = (body: string): WikiLinkTarget | undefined => {
    const trimmed = body.trim();
    if (!trimmed) return undefined;

    // Type prefix (folio | quest | epic | blob). Bare token = folio.
    let type: "folio" | "quest" | "epic" | "blob" = "folio";
    let rest = trimmed;
    const colonIdx = rest.indexOf(":");
    if (colonIdx > 0) {
      const prefix = rest.slice(0, colonIdx).trim().toLowerCase();
      if (
        prefix === "quest" ||
        prefix === "folio" ||
        prefix === "epic" ||
        prefix === "blob"
      ) {
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
      const blob = resolveBlob(rest);
      if (!blob) return brokenTarget(body, "blob-not-found");
      return {
        kind: "blob",
        href: `/api/files/${blob.fileId}`,
        label: blob.name,
      };
    }

    if (type === "quest") {
      let quest: QuestRef | undefined;
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
        return brokenTarget(
          body,
          questAmbiguous ? "ambiguous-title" : "quest-not-found",
        );
      }
      return {
        kind: "quest",
        href: `/${projectSlug}/quests/${quest.shortId}`,
        label: quest.title,
      };
    }

    if (type === "epic") {
      let epic: EpicRef | undefined;
      let epicAmbiguous = false;
      if (rest.startsWith("#")) {
        const n = Number.parseInt(rest.slice(1), 10);
        epic = Number.isFinite(n) ? epicByNumber.get(n) : undefined;
      } else {
        const hit = epicByTitle.get(rest.toLowerCase().trim());
        if (hit && hit.count === 1) epic = hit.epic;
        else if (hit && hit.count > 1) epicAmbiguous = true;
      }
      if (!epic) {
        return brokenTarget(
          body,
          epicAmbiguous ? "ambiguous-title" : "epic-not-found",
        );
      }
      return {
        kind: "epic",
        // `shortId` here IS the epic's `number` — see `EpicRef`.
        href: `/${projectSlug}/epics/${epic.shortId}`,
        label: epic.title,
      };
    }

    // Folio.
    let folio: Folio | undefined;
    let pathLabel: string | undefined;
    if (rest.startsWith("#")) {
      const n = Number.parseInt(rest.slice(1), 10);
      folio = Number.isFinite(n) ? folioByShort.get(n) : undefined;
    } else if (rest.includes("/")) {
      const pathHit = resolvePathToken(rest, paths());
      if (pathHit) {
        folio = folioByShort.get(pathHit.shortId);
        // Keep the token verbatim as the display label so the reader sees
        // the same path they typed — bare folio titles ("admin", "roadmap")
        // repeat across buckets and need the path to read.
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
      if (folioAmbiguous) return brokenTarget(body, "ambiguous-title");
      // Only for the `#N` form. A bare title that matches no folio says
      // nothing about quests — the two namespaces are unrelated.
      if (rest.startsWith("#")) {
        const n = Number.parseInt(rest.slice(1), 10);
        if (Number.isFinite(n) && questByShort.has(n)) {
          return brokenTarget(body, "folio-not-found-quest-exists", n);
        }
      }
      return brokenTarget(body, "folio-not-found");
    }
    // Folio detail lives under `/folios/:shortId` — keep this in sync with
    // AppRouter.
    const href = anchor
      ? `/${projectSlug}/folios/${folio.shortId}#${slugifyAnchor(anchor)}`
      : `/${projectSlug}/folios/${folio.shortId}`;
    return {
      kind: "folio",
      href,
      label: (pathLabel ?? folio.title) + (anchor ? ` § ${anchor}` : ""),
    };
  };

  return { resolve, resolveBlob, resolveBlobByName };
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
const slugifyAnchor = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
