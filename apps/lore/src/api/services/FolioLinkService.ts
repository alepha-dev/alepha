import { $repository } from "alepha/orm";
import { folioBlobs } from "../entities/folioBlobs.ts";
import { folioDirectories } from "../entities/folioDirectories.ts";
import { type FolioLink, folioLinks } from "../entities/folioLinks.ts";
import { type Folio, folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";

/**
 * Structured token parsed out of a `[[...]]` wiki-link. The optional
 * `type` prefix dispatches to a different target table; the optional
 * `anchor` is a heading slug (folio-only for v1) preserved through to
 * the renderer.
 */
export interface ParsedToken {
  /** Target table — `folio` (default), `quest`, or `blob`. */
  type: "folio" | "quest" | "blob";
  /**
   * The reference body. `#N` means lookup by shortId; for blobs, a bare
   * value (no `#`) is a UUID lookup. Anything else (folio only) means
   * lookup by title (case-insensitive). The leading `#` is preserved so
   * resolvers can pattern-match without splitting again.
   */
  ref: string;
  /** Heading slug for anchor links — `undefined` when the token has no `#suffix`. */
  anchor?: string;
  /** Original token (between the `[[` and `]]`) for debugging / rendering. */
  raw: string;
}

/**
 * Maximum number of outbound `[[...]]` references parsed from a single
 * folio's content. Hard ceiling so a pathological note can't blow up the
 * link table or the resolution query budget.
 */
const MAX_LINKS_PER_FOLIO = 200;

/**
 * Sentinel for "project root" in the path-resolution maps. Directories
 * with `parentId === null` (or undefined) bucket under this key; folios
 * with no `directoryId` likewise. Using a non-UUID string keeps the
 * sentinel from ever colliding with a real directory id.
 */
const ROOT_DIR = "root";

/**
 * Precomputed lookup structures for path-style link resolution. Built
 * once per `resolveTokenIds` call when at least one token contains a `/`,
 * otherwise skipped to keep the title-only happy path cheap.
 *
 * - `childrenByParent`: parent dir id (or {@link ROOT_DIR}) → map of
 *   lowercased directory name → `{ id, count }`. `count > 1` means two
 *   siblings collide on case-insensitive name (shouldn't happen given
 *   the `folio_names` UNIQUE INDEX, but we defensively drop such
 *   matches).
 * - `foliosByDir`: dir id (or {@link ROOT_DIR}) → map of lowercased title
 *   → `{ id, count }`. Same collision rule.
 * - `dirNameById` / `dirParentById`: per-directory metadata, used by the
 *   suffix-match pass to walk parent chains.
 */
interface PathContext {
  childrenByParent: Map<string, Map<string, { id: string; count: number }>>;
  foliosByDir: Map<string, Map<string, { id: string; count: number }>>;
  dirNameById: Map<string, string>;
  dirParentById: Map<string, string | null>;
}

/**
 * Parse + resolve + persist wiki-style `[[link]]` references between
 * folios. Used by `FolioController` on every folio create/update to keep
 * `folio_links` in sync with the current content.
 *
 * Resolution rules (scoped to the folio's project — folios are
 * project-shared, so any member's folio is a valid target):
 * - `[[#12]]` matches the folio with `shortId = 12`.
 * - `[[dir/sub/name]]` matches by folio path. Tried anchored at the
 *   project root first (`dir` is a root directory, `sub` is its child,
 *   `name` is a folio inside `sub`). If that fails and the path has 2+
 *   segments, falls back to a *suffix* match: any directory chain in the
 *   tree whose trailing names equal the leading segments AND that
 *   contains a folio matching the last segment. Suffix matches are
 *   accepted only when unique — multiple hits drop the link.
 * - `[[Some title]]` (no slash) matches by title, case-insensitive.
 *   Multiple-title collisions drop the link.
 * - Unresolved references are silently ignored — the UI may surface them
 *   as plain italic to flag the dangling reference to the author.
 */
export class FolioLinkService {
  protected readonly folios = $repository(folios);
  protected readonly links = $repository(folioLinks);
  protected readonly quests = $repository(quests);
  protected readonly directories = $repository(folioDirectories);
  protected readonly blobs = $repository(folioBlobs);

  /**
   * Extract `[[...]]` tokens from markdown content into structured
   * {@link ParsedToken}s. Stops at `MAX_LINKS_PER_FOLIO` matches so a
   * runaway note can't cost unbounded resolution work. Dedupes by
   * normalized (type, ref, anchor) so the same token written twice
   * produces one link.
   */
  public parseTokens(content: string): ParsedToken[] {
    const out: ParsedToken[] = [];
    if (!content) return out;
    const seen = new Set<string>();
    const re = /\[\[([^\]\n]+)\]\]/g;
    let match: RegExpExecArray | null = re.exec(content);
    while (match !== null) {
      const parsed = this.parseToken(match[1]);
      if (parsed) {
        const dedupKey = `${parsed.type}:${parsed.ref}#${parsed.anchor ?? ""}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          out.push(parsed);
          if (out.length >= MAX_LINKS_PER_FOLIO) break;
        }
      }
      match = re.exec(content);
    }
    return out;
  }

  /**
   * Parse a single raw token body (between `[[` and `]]`) into a
   * structured target. Returns `undefined` on empty input.
   *
   * Syntax precedence:
   * 1. Optional `type:` prefix (`quest:`). Bare ref keeps the folio
   *    default for backwards compatibility.
   * 2. Optional `#anchor` suffix on folio refs only (anchors on
   *    typed entities are deferred per the spec).
   */
  public parseToken(raw: string): ParsedToken | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    let type: "folio" | "quest" | "blob" = "folio";
    let body = trimmed;
    const colonIdx = body.indexOf(":");
    // A leading `#N` is a folio shortId — the `#` is NOT a type
    // separator. Only treat `something:rest` as typed if `something`
    // is a known prefix.
    if (colonIdx > 0) {
      const prefix = body.slice(0, colonIdx).trim().toLowerCase();
      if (prefix === "quest" || prefix === "folio" || prefix === "blob") {
        type = prefix;
        body = body.slice(colonIdx + 1).trim();
      }
    }

    // Anchors are folio-only for v1. On a quest token, an embedded `#`
    // is the shortId separator (e.g. `quest#32`), NOT an anchor.
    let anchor: string | undefined;
    if (type === "folio") {
      // For `[[#42#areas]]` (shortId + anchor) the FIRST `#` is part of
      // the ref; the second `#` starts the anchor. For `[[Title#anchor]]`
      // there's only one `#`. Detect the form by leading-`#`.
      if (body.startsWith("#")) {
        const second = body.indexOf("#", 1);
        if (second !== -1) {
          anchor = body.slice(second + 1).trim() || undefined;
          body = body.slice(0, second);
        }
      } else {
        const hashIdx = body.indexOf("#");
        if (hashIdx !== -1) {
          anchor = body.slice(hashIdx + 1).trim() || undefined;
          body = body.slice(0, hashIdx).trim();
        }
      }
    }

    return { type, ref: body, anchor, raw: trimmed };
  }

  /**
   * Resolve a list of structured tokens into target rows scoped to the
   * source folio's project. Returns the deduped set of
   * `{ targetType, toId }` pairs. Self-links are filtered out.
   *
   * Both folios and quests are project-scoped only — any project member
   * sees the same target sets.
   */
  public async resolveTokenIds(
    tokens: ParsedToken[],
    projectId: number,
    sourceFolioId: string,
  ): Promise<Array<{ targetType: "folio" | "quest" | "blob"; toId: string }>> {
    if (tokens.length === 0) return [];

    const needsFolios = tokens.some((t) => t.type === "folio");
    const needsQuests = tokens.some((t) => t.type === "quest");
    const needsBlobs = tokens.some((t) => t.type === "blob");
    const needsPaths = tokens.some(
      (t) =>
        t.type === "folio" && t.ref.includes("/") && !t.ref.startsWith("#"),
    );

    // In-memory maps after at most two DB roundtrips. Bounded by the
    // per-project folio and quest counts.
    const folioById = new Map<number, string>();
    const folioByTitle = new Map<string, { id: string; count: number }>();
    // Path-resolution structures — built only when at least one token
    // looks like a path (`a/b/c`). Lazy to keep title-only lookups cheap.
    const pathContext: PathContext = {
      childrenByParent: new Map(),
      foliosByDir: new Map(),
      dirNameById: new Map(),
      dirParentById: new Map(),
    };
    if (needsFolios) {
      const candidates = await this.folios.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "shortId", "title", "directoryId"],
      });
      for (const c of candidates) {
        folioById.set(c.shortId, c.id);
        const key = c.title.toLowerCase().trim();
        const existing = folioByTitle.get(key);
        if (existing) existing.count++;
        else folioByTitle.set(key, { id: c.id, count: 1 });
        if (needsPaths) {
          const dirKey = c.directoryId ?? ROOT_DIR;
          let inDir = pathContext.foliosByDir.get(dirKey);
          if (!inDir) {
            inDir = new Map();
            pathContext.foliosByDir.set(dirKey, inDir);
          }
          const titleKey = c.title.toLowerCase().trim();
          const entry = inDir.get(titleKey);
          if (entry) entry.count++;
          else inDir.set(titleKey, { id: c.id, count: 1 });
        }
      }
      if (needsPaths) {
        const dirs = await this.directories.findMany({
          where: { projectId: { eq: projectId } },
          columns: ["id", "name", "parentId"],
        });
        for (const d of dirs) {
          pathContext.dirNameById.set(d.id, d.name);
          pathContext.dirParentById.set(d.id, d.parentId ?? null);
          const parentKey = d.parentId ?? ROOT_DIR;
          let bucket = pathContext.childrenByParent.get(parentKey);
          if (!bucket) {
            bucket = new Map();
            pathContext.childrenByParent.set(parentKey, bucket);
          }
          const nameKey = d.name.toLowerCase().trim();
          const entry = bucket.get(nameKey);
          if (entry) entry.count++;
          else bucket.set(nameKey, { id: d.id, count: 1 });
        }
      }
    }

    const questById = new Map<number, number>();
    const questByTitle = new Map<string, { id: number; count: number }>();
    if (needsQuests) {
      const candidates = await this.quests.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "shortId", "title"],
      });
      for (const c of candidates) {
        questById.set(c.shortId, c.id);
        const key = c.title.toLowerCase().trim();
        const existing = questByTitle.get(key);
        if (existing) existing.count++;
        else questByTitle.set(key, { id: c.id, count: 1 });
      }
    }

    // Blob refs only resolve by shortId (`#N`) or direct UUID — no
    // title lookup. Blob names aren't unique within a project (only
    // within a parent directory), so a title-style lookup would
    // collide too often to be useful.
    const blobByShort = new Map<number, string>();
    const blobUuids = new Set<string>();
    if (needsBlobs) {
      const candidates = await this.blobs.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["fileId", "shortId"],
      });
      for (const c of candidates) {
        blobByShort.set(c.shortId, c.fileId);
        blobUuids.add(c.fileId);
      }
    }

    const seen = new Set<string>();
    const resolved: Array<{
      targetType: "folio" | "quest" | "blob";
      toId: string;
    }> = [];
    for (const token of tokens) {
      const targetId = this.resolveParsedToken(
        token,
        folioById,
        folioByTitle,
        questById,
        questByTitle,
        pathContext,
        blobByShort,
        blobUuids,
      );
      if (!targetId) continue;
      if (token.type === "folio" && targetId === sourceFolioId) continue;
      const dedupKey = `${token.type}:${targetId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      resolved.push({ targetType: token.type, toId: targetId });
    }
    return resolved;
  }

  /**
   * Resolve a single structured token against the precomputed lookup
   * maps. Split out so callers (or tests) can exercise the matching
   * rules without going through the DB roundtrip.
   */
  protected resolveParsedToken(
    token: ParsedToken,
    folioById: Map<number, string>,
    folioByTitle: Map<string, { id: string; count: number }>,
    questById: Map<number, number>,
    questByTitle: Map<string, { id: number; count: number }>,
    pathContext?: PathContext,
    blobByShort?: Map<number, string>,
    blobUuids?: Set<string>,
  ): string | undefined {
    if (token.type === "blob") {
      // `blob#42` → shortId 42 in this project. Bare `blob:<uuid>` →
      // UUID lookup (validate it belongs to this project via the
      // precomputed set).
      if (token.ref.startsWith("#")) {
        const n = Number.parseInt(token.ref.slice(1), 10);
        if (!Number.isFinite(n)) return undefined;
        return blobByShort?.get(n);
      }
      const uuid = token.ref.trim();
      return blobUuids?.has(uuid) ? uuid : undefined;
    }
    if (token.type === "quest") {
      // `quest#32` → shortId 32. `quest:Title` → title lookup.
      if (token.ref.startsWith("#")) {
        const n = Number.parseInt(token.ref.slice(1), 10);
        if (!Number.isFinite(n)) return undefined;
        const id = questById.get(n);
        return id != null ? String(id) : undefined;
      }
      const hit = questByTitle.get(token.ref.toLowerCase().trim());
      if (!hit || hit.count > 1) return undefined;
      return String(hit.id);
    }
    // Folio (default).
    if (token.ref.startsWith("#")) {
      const n = Number.parseInt(token.ref.slice(1), 10);
      if (!Number.isFinite(n)) return undefined;
      return folioById.get(n);
    }
    // Path-style ref (`dir/sub/name`): try anchored-at-root, then
    // suffix-match. Falls through to title lookup if both fail — useful
    // when a folio's title legitimately contains a slash.
    if (pathContext && token.ref.includes("/")) {
      const pathHit = this.resolvePathToken(token.ref, pathContext);
      if (pathHit) return pathHit;
    }
    const hit = folioByTitle.get(token.ref.toLowerCase().trim());
    if (!hit || hit.count > 1) return undefined;
    return hit.id;
  }

  /**
   * Resolve a path-style ref (`a/b/c`) against the precomputed folio
   * tree. Returns the folio id if one (and only one) match is found.
   *
   * Two-pass matching:
   * 1. **Anchored at root** — segments[0] must be a root-level directory.
   *    Walk down. Last segment is the folio name inside the leaf dir.
   *    Single hit ⇒ accept. Otherwise fall to (2).
   * 2. **Suffix match** — only triggered when `dirSegments` has ≥ 1
   *    segment. Look across the project for any directory chain whose
   *    trailing names equal `dirSegments` AND that contains a folio
   *    matching the last segment. Accept iff exactly one such chain has a
   *    matching folio. Ambiguous → drop (caller falls back to title).
   */
  protected resolvePathToken(
    ref: string,
    ctx: PathContext,
  ): string | undefined {
    const segments = ref
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (segments.length < 2) return undefined;
    const nameKey = segments[segments.length - 1].toLowerCase();
    const dirSegments = segments.slice(0, -1).map((s) => s.toLowerCase());

    // Pass 1 — anchored at root.
    const anchored = this.walkPath(dirSegments, ROOT_DIR, ctx);
    if (anchored) {
      const folioHit = ctx.foliosByDir.get(anchored)?.get(nameKey);
      if (folioHit && folioHit.count === 1) return folioHit.id;
    }

    // Pass 2 — suffix match. For every directory whose name equals the
    // last directory segment, try to walk *up* matching the rest.
    const candidates: string[] = [];
    for (const [dirId, dirName] of ctx.dirNameById) {
      if (
        dirName.toLowerCase().trim() !== dirSegments[dirSegments.length - 1]
      ) {
        continue;
      }
      if (!this.chainEndsWith(dirId, dirSegments, ctx)) continue;
      const folioHit = ctx.foliosByDir.get(dirId)?.get(nameKey);
      if (folioHit && folioHit.count === 1) candidates.push(folioHit.id);
    }
    // Dedupe (a folio could be reached by multiple chains conceptually,
    // but each `foliosByDir` entry maps to a single folio id per dir).
    const unique = Array.from(new Set(candidates));
    return unique.length === 1 ? unique[0] : undefined;
  }

  /**
   * Walk down from `startDirId` (or root) through `segments`, lower-cased.
   * Returns the resolved directory id at the end of the path, or
   * `undefined` if any segment fails to match a unique child directory.
   */
  protected walkPath(
    segments: string[],
    startDirId: string,
    ctx: PathContext,
  ): string | undefined {
    let current = startDirId;
    for (const seg of segments) {
      const children = ctx.childrenByParent.get(current);
      if (!children) return undefined;
      const child = children.get(seg);
      if (!child || child.count > 1) return undefined;
      current = child.id;
    }
    return current;
  }

  /**
   * Verify that the parent chain of `dirId` (including itself) ends with
   * the given `segments` (last-to-first walk). Used by the suffix-match
   * pass.
   */
  protected chainEndsWith(
    dirId: string,
    segments: string[],
    ctx: PathContext,
  ): boolean {
    let cursor: string | null = dirId;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (!cursor) return false;
      const name = ctx.dirNameById.get(cursor);
      if (!name || name.toLowerCase().trim() !== segments[i]) return false;
      cursor = ctx.dirParentById.get(cursor) ?? null;
    }
    return true;
  }

  /**
   * Replace the set of outbound links for `fromFolio` with the union of
   * `[[...]]` references parsed from the supplied content. Idempotent.
   *
   * Callers should run this inside a transactional boundary (the lore
   * `FolioController` already wraps create/update with `$transactional()`)
   * so a partial sync never leaks orphan rows.
   */
  public async syncLinks(fromFolio: Folio, content: string): Promise<void> {
    const tokens = this.parseTokens(content);
    const targets = await this.resolveTokenIds(
      tokens,
      fromFolio.projectId,
      fromFolio.id,
    );

    await this.links.deleteMany({ fromId: { eq: fromFolio.id } });

    if (targets.length === 0) return;

    // One insert per target. Repository doesn't expose bulk insert in
    // a single call, and per-folio caps keep this loop small.
    for (const target of targets) {
      await this.links.create({
        fromId: fromFolio.id,
        toId: target.toId,
        targetType: target.targetType,
      });
    }
  }

  /**
   * Outbound links: folios this one points TO (parsed from its content).
   */
  public async findOutbound(fromId: string): Promise<FolioLink[]> {
    return this.links.findMany({
      where: { fromId: { eq: fromId } },
    });
  }

  /**
   * Inbound links: folios that point TO this folio (their content
   * contains a `[[...]]` that resolved here). Inbound resolution is
   * folio-only — quests don't have a `content` field that we scan.
   */
  public async findInbound(toId: string): Promise<FolioLink[]> {
    return this.links.findMany({
      where: { toId: { eq: toId }, targetType: { eq: "folio" } },
    });
  }

  /**
   * Resolve quest target ids (integers) to display refs. Helper for
   * `FolioController.getLinks` — kept on the service so the controller
   * doesn't grow a direct dependency on the quests repository for
   * link-resolution concerns.
   */
  public async findQuestRefs(
    ids: number[],
  ): Promise<Array<{ id: number; shortId: number; title: string }>> {
    if (ids.length === 0) return [];
    return this.quests.findMany({
      where: { id: { inArray: ids } },
      columns: ["id", "shortId", "title"],
    });
  }

  /**
   * Walk every folio in a project and rewrite `[[dir/sub/name]]`
   * folio-path tokens whose path no longer matches the target folio's
   * current location (Lore quest #108). Resolution itself is robust
   * thanks to the title-fallback + suffix-match logic, but the path
   * token in the source markdown is cosmetically stale after a move and
   * misleads the reader.
   *
   * Rules — kept conservative on purpose:
   *
   * - Only touches `type = folio` tokens whose `ref` contains a `/` and
   *   doesn't start with `#`. Bare title refs and `#N` shortId refs are
   *   already stable across moves; leave them alone.
   * - Skips quest / blob tokens.
   * - Skips dangling refs (token doesn't resolve at all) — the author
   *   should still see the broken link, not have it silently rewritten.
   * - Skips protected folios — their content is a crypto envelope.
   * - Preserves the original `folio:` prefix if present and the
   *   `#anchor` suffix verbatim.
   *
   * Canonical form for a resolved target:
   * - Target at project root → `[[<title>]]` (bare; no path needed).
   * - Target inside a directory → `[[<dir1>/.../<title>]]` (full chain
   *   anchored at root). Never emits suffix-shorthand.
   *
   * When `dryRun` is true, no folios are written — the change set is
   * computed and returned untouched. When false, each modified folio is
   * persisted via the supplied `updateContent` callback so the standard
   * revision/audit path (folio_revisions row, `syncLinks` follow-up) is
   * exercised exactly once per folio.
   *
   * Returns one row per folio whose content actually changed.
   */
  public async tidyStalePaths(
    projectId: number,
    options: {
      dryRun: boolean;
      updateContent: (folioId: string, newContent: string) => Promise<void>;
    },
  ): Promise<{
    scanned: number;
    rewritten: number;
    dryRun: boolean;
    changes: Array<{
      folioShortId: number;
      tokens: Array<{ before: string; after: string; count: number }>;
    }>;
  }> {
    // 1) Load every folio in the project + the directory tree once.
    const allFolios = await this.folios.findMany({
      where: { projectId: { eq: projectId } },
      columns: [
        "id",
        "shortId",
        "title",
        "content",
        "directoryId",
        "protected" as never,
      ],
    });
    const dirs = await this.directories.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id", "name", "parentId"],
    });

    // 2) Build the directory ancestor chain → canonical path map. For
    // each folio, we need the slash-joined chain of its directory's
    // names from the root downward.
    const dirNameById = new Map<string, string>();
    const dirParentById = new Map<string, string | null>();
    for (const d of dirs) {
      dirNameById.set(d.id, d.name);
      dirParentById.set(d.id, d.parentId ?? null);
    }
    const dirChain = (dirId: string | null | undefined): string[] => {
      const chain: string[] = [];
      let cursor: string | null | undefined = dirId ?? null;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const name = dirNameById.get(cursor);
        if (!name) break;
        chain.unshift(name);
        cursor = dirParentById.get(cursor) ?? null;
      }
      return chain;
    };
    const canonicalRef = (folio: {
      title: string;
      directoryId: string | null | undefined;
    }): string => {
      const chain = dirChain(folio.directoryId);
      // Root-level target — bare title is enough; the path was only
      // there in the source because the folio used to live in a dir.
      if (chain.length === 0) return folio.title;
      return [...chain, folio.title].join("/");
    };

    // 3) Walk each (non-protected) folio. For every `[[...]]` token,
    // re-parse → only consider folio-type, slash-bearing, non-shortId
    // refs. Resolve. If resolved and the current canonical path
    // differs, queue a rewrite for this folio.
    const changes: Array<{
      folioShortId: number;
      tokens: Array<{ before: string; after: string; count: number }>;
    }> = [];

    // Folio + directory lookup maps for resolveParsedToken — built once.
    const folioById = new Map<number, string>();
    const folioByTitle = new Map<string, { id: string; count: number }>();
    const pathContext: PathContext = {
      childrenByParent: new Map(),
      foliosByDir: new Map(),
      dirNameById,
      dirParentById,
    };
    for (const f of allFolios) {
      folioById.set(f.shortId, f.id);
      const key = f.title.toLowerCase().trim();
      const existing = folioByTitle.get(key);
      if (existing) existing.count++;
      else folioByTitle.set(key, { id: f.id, count: 1 });
      const dirKey = f.directoryId ?? ROOT_DIR;
      let inDir = pathContext.foliosByDir.get(dirKey);
      if (!inDir) {
        inDir = new Map();
        pathContext.foliosByDir.set(dirKey, inDir);
      }
      const titleKey = f.title.toLowerCase().trim();
      const entry = inDir.get(titleKey);
      if (entry) entry.count++;
      else inDir.set(titleKey, { id: f.id, count: 1 });
    }
    for (const d of dirs) {
      const parentKey = d.parentId ?? ROOT_DIR;
      let bucket = pathContext.childrenByParent.get(parentKey);
      if (!bucket) {
        bucket = new Map();
        pathContext.childrenByParent.set(parentKey, bucket);
      }
      const nameKey = d.name.toLowerCase().trim();
      const entry = bucket.get(nameKey);
      if (entry) entry.count++;
      else bucket.set(nameKey, { id: d.id, count: 1 });
    }
    const folioMetaById = new Map<
      string,
      { title: string; directoryId: string | null | undefined }
    >();
    for (const f of allFolios) {
      folioMetaById.set(f.id, {
        title: f.title,
        directoryId: f.directoryId,
      });
    }

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    for (const folio of allFolios) {
      if ((folio as unknown as { protected?: boolean }).protected) continue;
      const content = folio.content ?? "";
      if (!content.includes("[[")) continue;

      const tokens = this.parseTokens(content);
      type Rewrite = { before: string; after: string; count: number };
      const rewrites: Rewrite[] = [];
      const seenBefore = new Set<string>();

      for (const token of tokens) {
        if (token.type !== "folio") continue;
        if (token.ref.startsWith("#")) continue;
        if (!token.ref.includes("/")) continue;
        let targetId = this.resolveParsedToken(
          token,
          folioById,
          folioByTitle,
          new Map(),
          new Map(),
          pathContext,
        );
        // Tidy-specific fallback: when the path resolver fails (the
        // target moved out of the chain in the ref), look up the last
        // segment as a bare title. Accept only when unique — ambiguous
        // titles stay dangling so we don't rewrite to the wrong folio.
        if (!targetId) {
          const last = token.ref.split("/").filter(Boolean).pop();
          if (last) {
            const hit = folioByTitle.get(last.toLowerCase().trim());
            if (hit && hit.count === 1) targetId = hit.id;
          }
        }
        if (!targetId) continue;
        const target = folioMetaById.get(targetId);
        if (!target) continue;
        const canonical = canonicalRef(target);
        if (canonical.toLowerCase() === token.ref.toLowerCase()) continue;

        // Reconstruct the literal `[[...]]` body — preserve optional
        // `folio:` prefix and `#anchor` exactly as the author wrote them.
        const hasPrefix = /^folio:/i.test(token.raw);
        const before = hasPrefix
          ? `folio:${token.ref}${token.anchor ? `#${token.anchor}` : ""}`
          : `${token.ref}${token.anchor ? `#${token.anchor}` : ""}`;
        const after = hasPrefix
          ? `folio:${canonical}${token.anchor ? `#${token.anchor}` : ""}`
          : `${canonical}${token.anchor ? `#${token.anchor}` : ""}`;
        if (seenBefore.has(before)) continue;
        seenBefore.add(before);
        // Count occurrences of `[[<before>]]` (case-sensitive — the
        // resolver is case-insensitive but the rewrite needs to land on
        // the exact text the author wrote so the regex matches).
        const re = new RegExp(`\\[\\[${escapeRegex(before)}\\]\\]`, "g");
        const matches = content.match(re);
        const count = matches?.length ?? 0;
        if (count === 0) continue;
        rewrites.push({ before, after, count });
      }

      if (rewrites.length === 0) continue;

      let newContent = content;
      for (const r of rewrites) {
        const re = new RegExp(`\\[\\[${escapeRegex(r.before)}\\]\\]`, "g");
        newContent = newContent.replace(re, `[[${r.after}]]`);
      }

      changes.push({ folioShortId: folio.shortId, tokens: rewrites });

      if (!options.dryRun) {
        await options.updateContent(folio.id, newContent);
      }
    }

    return {
      scanned: allFolios.length,
      rewritten: changes.length,
      dryRun: options.dryRun,
      changes,
    };
  }
}
