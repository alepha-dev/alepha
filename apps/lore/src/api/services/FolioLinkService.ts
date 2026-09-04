import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { splitMarkdownCode } from "../../web/app/components/folios/markdownCodeSegments.ts";
import { parseTypedReference } from "../../web/app/components/shared/element/typedReference.ts";
import { type Epic, epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { folioBlobs } from "../entities/folioBlobs.ts";
import { folioDirectories } from "../entities/folioDirectories.ts";
import { type FolioLink, folioLinks } from "../entities/folioLinks.ts";
import { type Folio, folios } from "../entities/folios.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import type { LinkSourceKind } from "../schemas/linkSourceKindSchema.ts";
import type { LinkTargetKind } from "../schemas/linkTargetKindSchema.ts";
import { BoundParameters } from "./BoundParameters.ts";

/**
 * Structured token parsed out of a `[[...]]` wiki-link. The optional
 * `type` prefix dispatches to a different target table; the optional
 * `anchor` is a heading slug (folio-only for v1) preserved through to
 * the renderer.
 */
export interface ParsedToken {
  /**
   * Target table — `folio` (default), `quest`, `epic`, `blob`, and since
   * epic #32 `feedback` and `release`, which only the typed grammar
   * (`#P120`, `#R12`) can name.
   */
  type: LinkTargetKind;
  /**
   * The reference body. `#N` means lookup by shortId; for blobs, a bare
   * value (no `#`) is a UUID lookup. Anything else (folio only) means
   * lookup by title (case-insensitive). The leading `#` is preserved so
   * resolvers can pattern-match without splitting again.
   */
  ref: string;
  /**
   * Heading slug for anchor links — `undefined` when the token has no `#suffix`.
   */
  anchor?: string;
  /**
   * Original token (between the `[[` and `]]`) for debugging / rendering.
   */
  raw: string;
}

/**
 * What a `[[...]]` reference was found IN. `id` is stringified into
 * `folio_links.from_id`, which holds ids from four different tables.
 */
export interface LinkSource {
  kind: LinkSourceKind;
  id: string | number;
  projectId: number;
}

/**
 * Everything {@link FolioLinkService.resolveParsedToken} needs to answer a
 * token without touching the database, precomputed once per sync.
 *
 * An object rather than positional parameters because the list grows every
 * time a target type is added — it was already eight arguments before
 * `epic`, and two more positional maps of the same shape is how a call site
 * silently passes quests where epics belong.
 */
interface TokenLookupMaps {
  folioById: Map<number, string>;
  folioByTitle: Map<string, { id: string; count: number }>;
  questById: Map<number, number>;
  questByTitle: Map<string, { id: number; count: number }>;
  epicByNumber: Map<number, number>;
  epicByTitle: Map<string, { id: number; count: number }>;
  pathContext?: PathContext;
  blobByShort?: Map<number, string>;
  blobUuids?: Set<string>;
  /**
   * `feedback.shortId` → `feedback.id`. Number only: feedback and releases
   * are reachable through the typed grammar alone, so there is no title
   * lookup to keep ambiguous.
   */
  feedbackByShort?: Map<number, number>;
  /**
   * `releases.number` → `releases.id`. The tag is never an address.
   */
  releaseByNumber?: Map<number, number>;
}

/**
 * Precomputed lookup structures for path-style link resolution. Built
 * once per `resolveTokenIds` call when at least one token contains a `/`,
 * otherwise skipped to keep the title-only happy path cheap.
 *
 * - `childrenByParent`: parent dir id (or {@link FolioLinkService.ROOT_DIR}) → map of
 *   lowercased directory name → `{ id, count }`. `count > 1` means two
 *   siblings collide on case-insensitive name (shouldn't happen given
 *   the `folio_names` UNIQUE INDEX, but we defensively drop such
 *   matches).
 * - `foliosByDir`: dir id (or {@link FolioLinkService.ROOT_DIR}) → map of lowercased title
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
 * - `[[#Q12]]`, `[[#E3]]`, `[[#F12]]` are the typed grammar (epic #32): the
 *   letter names the kind, the number is its per-project id. Tried first,
 *   and read through `typedReference.ts`, the same module the browser
 *   resolver reads it through.
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
  /**
   * Maximum number of outbound `[[...]]` references parsed from a single
   * folio's content. Hard ceiling so a pathological note can't blow up the
   * link table or the resolution query budget.
   */
  protected readonly MAX_LINKS_PER_FOLIO = 200;

  /**
   * Sentinel for "project root" in the path-resolution maps. Directories
   * with `parentId === null` (or undefined) bucket under this key; folios
   * with no `directoryId` likewise. Using a non-UUID string keeps the
   * sentinel from ever colliding with a real directory id.
   */
  protected readonly ROOT_DIR = "root";
  protected readonly folios = $repository(folios);
  protected readonly links = $repository(folioLinks);
  protected readonly quests = $repository(quests);
  protected readonly epics = $repository(epics);
  protected readonly directories = $repository(folioDirectories);
  protected readonly blobs = $repository(folioBlobs);
  protected readonly feedbackRows = $repository(feedback);
  protected readonly releaseRows = $repository(releases);
  protected readonly bound = $inject(BoundParameters);

  /**
   * Extract `[[...]]` tokens from markdown content into structured
   * {@link ParsedToken}s. Stops at `this.MAX_LINKS_PER_FOLIO` matches so a
   * runaway note can't cost unbounded resolution work. Dedupes by
   * normalized (type, ref, anchor) so the same token written twice
   * produces one link.
   *
   * Fenced blocks and inline code spans are held out. A regex cannot see a
   * fence, and the reader has skipped code since #1261
   * (`rewriteFolioWikiLinks`); until this side did the same, a token quoted
   * inside backticks wrote an edge into the graph that no page ever showed
   * as a link. Same splitter as the reader, so the two agree on what code is.
   */
  public parseTokens(content: string): ParsedToken[] {
    const out: ParsedToken[] = [];
    if (!content) return out;
    const seen = new Set<string>();
    for (const segment of splitMarkdownCode(content)) {
      if (segment.code) continue;
      const re = /\[\[([^\]\n]+)\]\]/g;
      let match: RegExpExecArray | null = re.exec(segment.text);
      while (match !== null) {
        const parsed = this.parseToken(match[1]);
        if (parsed) {
          const dedupKey = this.tokenKey(parsed);
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            out.push(parsed);
            if (out.length >= this.MAX_LINKS_PER_FOLIO) return out;
          }
        }
        match = re.exec(segment.text);
      }
    }
    return out;
  }

  /**
   * Parse a single raw token body (between `[[` and `]]`) into a
   * structured target. Returns `undefined` on empty input.
   *
   * Syntax precedence:
   * 1. The typed grammar, `#Q12` / `#E3` / `#F12` (`typedReference.ts`).
   * 2. Optional `type:` prefix (`quest:`). Bare ref keeps the folio
   *    default for backwards compatibility.
   * 3. Optional `#anchor` suffix on folio refs only (anchors on
   *    typed entities are deferred per the spec).
   */
  public parseToken(raw: string): ParsedToken | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    // Under the legacy rules below the same string reads as a folio ref
    // whose number is `Q12`, which parses to nothing, so this branch only
    // ever claims tokens that resolved to nothing before it existed. The
    // ref keeps the `#N` shape the resolver already matches on per kind.
    const typed = parseTypedReference(trimmed);
    if (typed) return { type: typed.kind, ref: `#${typed.id}`, raw: trimmed };

    let type: LinkTargetKind = "folio";
    let body = trimmed;
    const colonIdx = body.indexOf(":");
    // A leading `#N` is a folio shortId — the `#` is NOT a type
    // separator. Only treat `something:rest` as typed if `something`
    // is a known prefix.
    if (colonIdx > 0) {
      const prefix = body.slice(0, colonIdx).trim().toLowerCase();
      if (
        prefix === "quest" ||
        prefix === "folio" ||
        prefix === "epic" ||
        prefix === "blob"
      ) {
        type = prefix;
        body = body.slice(colonIdx + 1).trim();
      }
    }

    // Anchors are folio-only. On a quest or epic token an embedded `#` is
    // the number separator (`quest:#32`, `epic:#3`), NOT an anchor.
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
  ): Promise<Array<{ targetType: LinkTargetKind; toId: string }>> {
    if (tokens.length === 0) return [];
    const maps = await this.buildLookupMaps(tokens, projectId);

    const seen = new Set<string>();
    const resolved: Array<{
      targetType: LinkTargetKind;
      toId: string;
    }> = [];
    for (const token of tokens) {
      const targetId = this.resolveParsedToken(token, maps);
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
   * Resolve tokens one by one and keep the pairing, keyed by
   * {@link FolioLinkService.tokenKey}. What the reference converter of epic
   * #32 needs: it rewrites each token in place and has to know which target
   * THAT token reached, where {@link FolioLinkService.resolveTokenIds}
   * answers with the deduped set of targets a body reaches. The lookup
   * tables are read once for the whole list, so a caller collects every
   * token of a project before asking.
   */
  public async resolveTokensEach(
    tokens: ParsedToken[],
    projectId: number,
  ): Promise<Map<string, { targetType: LinkTargetKind; toId: string }>> {
    const out = new Map<string, { targetType: LinkTargetKind; toId: string }>();
    if (tokens.length === 0) return out;
    const maps = await this.buildLookupMaps(tokens, projectId);
    for (const token of tokens) {
      const key = this.tokenKey(token);
      if (out.has(key)) continue;
      const toId = this.resolveParsedToken(token, maps);
      if (toId) out.set(key, { targetType: token.type, toId });
    }
    return out;
  }

  /**
   * The identity of a token for dedup and lookup: same kind, same
   * reference, same anchor. What `parseTokens` dedupes on.
   */
  public tokenKey(token: ParsedToken): string {
    return `${token.type}:${token.ref}#${token.anchor ?? ""}`;
  }

  /**
   * Read every lookup table a list of tokens can need, once. Which tables
   * is decided by the token kinds present, so a body with only `#Q` refs
   * never reads folios or directories.
   */
  protected async buildLookupMaps(
    tokens: ParsedToken[],
    projectId: number,
  ): Promise<TokenLookupMaps> {
    const needsFolios = tokens.some((t) => t.type === "folio");
    const needsQuests = tokens.some((t) => t.type === "quest");
    const needsEpics = tokens.some((t) => t.type === "epic");
    const needsBlobs = tokens.some((t) => t.type === "blob");
    const needsFeedback = tokens.some((t) => t.type === "feedback");
    const needsReleases = tokens.some((t) => t.type === "release");
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
          const dirKey = c.directoryId ?? this.ROOT_DIR;
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
          const parentKey = d.parentId ?? this.ROOT_DIR;
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

    // Epics are addressed by their per-project `number`, NOT a `shortId` —
    // that is the column epics actually carry, and it is what `[[epic:#3]]`
    // and the `/epics/:epicNumber` route both mean.
    const epicByNumber = new Map<number, number>();
    const epicByTitle = new Map<string, { id: number; count: number }>();
    if (needsEpics) {
      const candidates = await this.epics.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "number", "title"],
      });
      for (const c of candidates) {
        epicByNumber.set(c.number, c.id);
        const key = c.title.toLowerCase().trim();
        const existing = epicByTitle.get(key);
        if (existing) existing.count++;
        else epicByTitle.set(key, { id: c.id, count: 1 });
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

    // Feedback and releases are addressed by number only (`#P120`, `#R12`),
    // so one two-column read each and no title map.
    const feedbackByShort = new Map<number, number>();
    if (needsFeedback) {
      const candidates = await this.feedbackRows.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "shortId"],
      });
      for (const c of candidates) feedbackByShort.set(c.shortId, c.id);
    }
    const releaseByNumber = new Map<number, number>();
    if (needsReleases) {
      const candidates = await this.releaseRows.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["id", "number"],
      });
      for (const c of candidates) releaseByNumber.set(c.number, c.id);
    }

    return {
      folioById,
      folioByTitle,
      questById,
      questByTitle,
      epicByNumber,
      epicByTitle,
      pathContext,
      blobByShort,
      blobUuids,
      feedbackByShort,
      releaseByNumber,
    };
  }

  /**
   * Resolve a single structured token against the precomputed lookup
   * maps. Split out so callers (or tests) can exercise the matching
   * rules without going through the DB roundtrip.
   */
  protected resolveParsedToken(
    token: ParsedToken,
    maps: TokenLookupMaps,
  ): string | undefined {
    const {
      folioById,
      folioByTitle,
      questById,
      questByTitle,
      epicByNumber,
      epicByTitle,
      pathContext,
      blobByShort,
      blobUuids,
      feedbackByShort,
      releaseByNumber,
    } = maps;
    if (token.type === "feedback" || token.type === "release") {
      // Only the typed grammar produces these, so the ref is always `#N`.
      if (!token.ref.startsWith("#")) return undefined;
      const n = Number.parseInt(token.ref.slice(1), 10);
      if (!Number.isFinite(n)) return undefined;
      const id =
        token.type === "feedback"
          ? feedbackByShort?.get(n)
          : releaseByNumber?.get(n);
      return id != null ? String(id) : undefined;
    }
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
    if (token.type === "epic") {
      // `epic:#3` → the per-project `number` (an epic has no `shortId`).
      // `epic:Title` → title lookup, refused when ambiguous, exactly as
      // quests and folios treat a duplicated title.
      if (token.ref.startsWith("#")) {
        const n = Number.parseInt(token.ref.slice(1), 10);
        if (!Number.isFinite(n)) return undefined;
        const id = epicByNumber.get(n);
        return id != null ? String(id) : undefined;
      }
      const hit = epicByTitle.get(token.ref.toLowerCase().trim());
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
    const anchored = this.walkPath(dirSegments, this.ROOT_DIR, ctx);
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
  public async syncLinks(source: LinkSource, content: string): Promise<void> {
    const fromId = String(source.id);
    const tokens = this.parseTokens(content);
    const targets = await this.resolveTokenIds(
      tokens,
      source.projectId,
      // Self-link suppression is folio-only because `toId` for a folio is a
      // UUID: comparing a quest's stringified integer against it can never
      // match anyway, so passing it would be noise rather than a filter.
      source.kind === "folio" ? fromId : "",
    );

    await this.links.deleteMany({
      fromType: { eq: source.kind },
      fromId: { eq: fromId },
    });

    if (targets.length === 0) return;

    // One multi-row INSERT, not one per target. This runs on EVERY folio
    // and quest write, and on D1 an insert is a round trip: a folio with
    // 20 wiki links used to pay 20 of them per save, and now pays one.
    //
    // ⚠️ `createMany` chunks at 1000 and its batches are not atomic on
    // their own. That costs nothing here — `FolioController` wraps
    // create/update in `$transactional()`, and this delete-then-insert was
    // never atomic without it.
    await this.links.createMany(
      targets.map((target) => ({
        fromType: source.kind,
        fromId,
        toId: target.toId,
        targetType: target.targetType,
      })),
    );
  }

  /**
   * Drop every outbound link from one source.
   *
   * ⚠️ This is what replaced `from_id`'s `ON DELETE CASCADE`, which went
   * when the column stopped being a foreign key. A delete handler that
   * forgets to call it leaves orphan rows, and nothing in the schema will
   * say so — the rows are simply never read again, and `findInbound` on a
   * recycled id would surface them. Called from `FolioController.delete`;
   * quest and epic delete must call it too.
   */
  public async deleteLinksFrom(source: {
    kind: LinkSourceKind;
    id: string | number;
  }): Promise<void> {
    await this.links.deleteMany({
      fromType: { eq: source.kind },
      fromId: { eq: String(source.id) },
    });
  }

  /**
   * How many link rows point at a kind of target, across every project.
   * The dry run of the reference converter (epic #32) reports it before
   * {@link FolioLinkService.deleteLinksTo} removes them.
   */
  public async countLinksTo(targetType: LinkTargetKind): Promise<number> {
    const rows = await this.links.findMany({
      where: { targetType: { eq: targetType } },
      columns: ["fromId"],
    });
    return rows.length;
  }

  /**
   * Drop every link row pointing at a kind of target, across every project,
   * and answer how many went. Exists for the `blob` rows: the purge of epic
   * #32 removes that literal from `linkTargetKindSchema`, and a stored value
   * the enum no longer has fails validation on read, so the rows must be
   * gone before the literal is.
   */
  public async deleteLinksTo(targetType: LinkTargetKind): Promise<number> {
    const count = await this.countLinksTo(targetType);
    if (count > 0) {
      await this.links.deleteMany({ targetType: { eq: targetType } });
    }
    return count;
  }

  /**
   * Outbound links: what this source points TO (parsed from its content).
   */
  public async findOutbound(source: {
    kind: LinkSourceKind;
    id: string | number;
  }): Promise<FolioLink[]> {
    return this.links.findMany({
      where: {
        fromType: { eq: source.kind },
        fromId: { eq: String(source.id) },
      },
    });
  }

  /**
   * Inbound links: everything that points TO this folio, whatever kind of
   * element the reference lives in.
   *
   * Still filtered to `targetType: "folio"` — the id space is per-table, so
   * without it a folio whose UUID happens to equal a stringified quest id
   * would collect that quest's backlinks. (It cannot today, UUIDs and
   * integers do not collide, but the filter is what makes that a fact
   * about the query rather than about the id format.)
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
    return this.bound.collect(ids, (batch) =>
      this.quests.findMany({
        where: { id: { inArray: batch } },
        columns: ["id", "shortId", "title"],
      }),
    );
  }

  /**
   * Resolve epic target ids (integers) to display refs. Sibling of
   * {@link findQuestRefs}, and it returns the epic's `number` under the
   * name `shortId` on purpose: the links payload has one row shape across
   * every kind, and `number` is the field an epic is addressed by
   * (`/epics/:epicNumber`), so it is what a link row has to carry.
   */
  public async findEpicRefs(
    ids: number[],
  ): Promise<Array<{ id: number; shortId: number; title: string }>> {
    const rows = await this.bound.collect(ids, (batch) =>
      this.epics.findMany({
        where: { id: { inArray: batch } },
        columns: ["id", "number", "title"],
      }),
    );
    return rows.map((r) => ({ id: r.id, shortId: r.number, title: r.title }));
  }

  /**
   * Resolve feedback target ids to display refs, the row shape the links
   * payload uses for every kind.
   */
  public async findFeedbackRefs(
    ids: number[],
  ): Promise<Array<{ id: number; shortId: number; title: string }>> {
    return this.bound.collect(ids, (batch) =>
      this.feedbackRows.findMany({
        where: { id: { inArray: batch } },
        columns: ["id", "shortId", "title"],
      }),
    );
  }

  /**
   * Resolve release target ids to display refs. As with epics, the
   * per-project `number` rides under `shortId`; the `tag` comes along
   * because it is what `/releases/:releaseTag` navigates by, and a release
   * may not have one.
   */
  public async findReleaseRefs(ids: number[]): Promise<
    Array<{
      id: number;
      shortId: number;
      title: string;
      tag?: string;
    }>
  > {
    const rows = await this.bound.collect(ids, (batch) =>
      this.releaseRows.findMany({
        where: { id: { inArray: batch } },
        columns: ["id", "number", "title", "tag"],
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      shortId: r.number,
      title: r.title,
      tag: r.tag,
    }));
  }

  /**
   * Rewrite every stored `[[...]]` reference that names this folio BY
   * TITLE, after the folio has been renamed.
   *
   * ## Why this exists at all, and only for folios
   *
   * The two reference forms age differently, and the `[[` picker chooses
   * between them deliberately:
   *
   * - A quest or epic is inserted as `quest#N` / `epic:#N`, because work
   *   gets retitled as it is understood. Those refs survive a rename
   *   untouched, which is why there is no quest/epic equivalent of this.
   * - A folio is inserted BY TITLE, because a folio's title is its
   *   identity and a title-keyed ref survives an export/import into
   *   another project.
   *
   * The cost of that choice is this method: rename a folio and every
   * reference to it silently stops resolving. The markdown still says the
   * old title, the reader gets a broken link, and nothing anywhere says
   * why.
   *
   * ## Driven by the link table, not a project scan
   *
   * `findInbound` names the exact sources to touch, across every element
   * kind — which is only possible because the source side went
   * polymorphic. `tidyStalePaths` predates that and still walks every
   * folio in the project; this does not, and it reaches quests and epics
   * that a folio-only walk never could.
   *
   * ## Conservative on purpose — it rewrites what a person wrote
   *
   * - Only `folio`-typed tokens whose ref matches the OLD title
   *   case-insensitively. `#N` refs are already rename-proof and are left
   *   alone.
   * - A `folio:` prefix and a trailing `#anchor` are preserved exactly.
   * - **Protected folios are skipped.** Their `content` is a ciphertext
   *   envelope the server cannot read, and must never try to: rewriting
   *   it would corrupt the folio. Their references stay stale, which is
   *   the same trade the protection domain makes everywhere else.
   * - A source whose text does not actually change is not saved, so this
   *   never bumps `updatedAt` for nothing.
   */
  public async rewriteTitleRefs(
    target: { id: string; projectId: number },
    oldTitle: string,
    newTitle: string,
  ): Promise<number> {
    const from = oldTitle.trim();
    const to = newTitle.trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return 0;

    const inbound = await this.findInbound(target.id);
    if (inbound.length === 0) return 0;

    const sources = await this.readRewriteSources(inbound);

    let rewritten = 0;
    for (const link of inbound) {
      if (link.fromType === "folio") {
        const folio = sources.folios.get(link.fromId);
        if (!folio) continue;
        // See the note above: never touch a protected folio's ciphertext.
        if ((folio as unknown as { protected?: boolean }).protected) continue;
        const next = this.replaceTitleToken(folio.content ?? "", from, to);
        if (next === (folio.content ?? "")) continue;
        await this.folios.updateById(folio.id, { content: next });
        await this.syncLinks(
          { kind: "folio", id: folio.id, projectId: folio.projectId },
          next,
        );
        rewritten++;
        continue;
      }

      if (link.fromType === "quest") {
        const id = Number.parseInt(link.fromId, 10);
        if (!Number.isFinite(id)) continue;
        const quest = sources.quests.get(id);
        if (!quest) continue;
        // All three markdown fields, because any of them could carry the
        // reference and `syncQuestLinks` scans all three.
        const patch: Record<string, string> = {};
        for (const field of [
          "description",
          "note",
          "completionMessage",
        ] as const) {
          const before = (quest as Record<string, unknown>)[field];
          if (typeof before !== "string" || !before) continue;
          const after = this.replaceTitleToken(before, from, to);
          if (after !== before) patch[field] = after;
        }
        if (Object.keys(patch).length === 0) continue;
        const updated = await this.quests.updateById(id, patch as never);
        await this.syncLinks(
          { kind: "quest", id, projectId: quest.projectId },
          [updated.description, updated.note, updated.completionMessage]
            .filter(Boolean)
            .join("\n\n"),
        );
        rewritten++;
        continue;
      }

      if (link.fromType === "epic") {
        const id = Number.parseInt(link.fromId, 10);
        if (!Number.isFinite(id)) continue;
        const epic = sources.epics.get(id);
        if (!epic) continue;
        const next = this.replaceTitleToken(epic.description ?? "", from, to);
        if (next === (epic.description ?? "")) continue;
        await this.epics.updateById(id, { description: next });
        await this.syncLinks(
          { kind: "epic", id, projectId: epic.projectId },
          next,
        );
        rewritten++;
      }
      // `comment` falls through: comments do not exist yet. When they do,
      // this is the one place that has to learn about them.
    }
    return rewritten;
  }

  /**
   * Every source a rename has to touch, in ONE query per source kind
   * rather than one per link.
   *
   * `rewriteTitleRefs` used to `findById` inside its loop, so renaming a
   * folio that 30 others link to was 30 reads before a single rewrite
   * happened. On D1 each of those is a full round trip, and the loop's
   * body then calls `syncLinks` — which is itself a delete plus an insert
   * per link. `DATABASE_TIMEOUT` defaults to 5000 ms on serverless, so
   * the reads were a real share of a budget the writes also have to fit
   * inside.
   *
   * ⚠️ `inArray: []` throws, so each partition is queried only when it has
   * ids - `BoundParameters.collect` gives no batch at all for an empty list,
   * which is what keeps that true. It also splits a long list, since the
   * number of folios linking to one folio is bounded by nothing.
   *
   * Ids are deduped: several links from the same source to the same target
   * are one row to read, not two.
   */
  protected async readRewriteSources(inbound: FolioLink[]): Promise<{
    folios: Map<string, Folio>;
    quests: Map<number, Quest>;
    epics: Map<number, Epic>;
  }> {
    const folioIds = new Set<string>();
    const questIds = new Set<number>();
    const epicIds = new Set<number>();

    for (const link of inbound) {
      if (link.fromType === "folio") {
        folioIds.add(link.fromId);
        continue;
      }
      const id = Number.parseInt(link.fromId, 10);
      if (!Number.isFinite(id)) continue;
      if (link.fromType === "quest") questIds.add(id);
      if (link.fromType === "epic") epicIds.add(id);
    }

    const [folioRows, questRows, epicRows] = await Promise.all([
      this.bound.collect([...folioIds], (batch) =>
        this.folios.findMany({ where: { id: { inArray: batch } } }),
      ),
      this.bound.collect([...questIds], (batch) =>
        this.quests.findMany({ where: { id: { inArray: batch } } }),
      ),
      this.bound.collect([...epicIds], (batch) =>
        this.epics.findMany({ where: { id: { inArray: batch } } }),
      ),
    ]);

    return {
      folios: new Map(folioRows.map((row) => [row.id, row])),
      quests: new Map(questRows.map((row) => [row.id, row])),
      epics: new Map(epicRows.map((row) => [row.id, row])),
    };
  }

  /**
   * Swap the title inside every `[[...]]` token that names `from`,
   * leaving the rest of the markdown byte-identical.
   *
   * Parses tokens rather than running a global string replace: a bare
   * `oldTitle` occurring in prose is not a reference and must not be
   * touched, and a `[[quest:Old Title]]` names a different entity that
   * happens to share the name.
   */
  protected replaceTitleToken(
    content: string,
    from: string,
    to: string,
  ): string {
    if (!content.includes("[[")) return content;
    const needle = from.toLowerCase();
    return content.replace(/\[\[([^\]\n]+)\]\]/g, (whole, body: string) => {
      const token = this.parseToken(body);
      if (!token || token.type !== "folio") return whole;
      if (token.ref.trim().toLowerCase() !== needle) return whole;
      // Preserve exactly what the author wrote around the title.
      const prefix = /^\s*folio:/i.test(body) ? "folio:" : "";
      const anchor = token.anchor ? `#${token.anchor}` : "";
      return `[[${prefix}${to}${anchor}]]`;
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
      const dirKey = f.directoryId ?? this.ROOT_DIR;
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
      const parentKey = d.parentId ?? this.ROOT_DIR;
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
        // Empty quest/epic maps are safe: the loop above skips every token
        // whose type is not `folio`, so no other resolver branch runs.
        let targetId = this.resolveParsedToken(token, {
          folioById,
          folioByTitle,
          questById: new Map(),
          questByTitle: new Map(),
          epicByNumber: new Map(),
          epicByTitle: new Map(),
          pathContext,
        });
        // Tidy-specific fallback: when the path resolver fails (the
        // target moved out of the chain in the ref), look up the last
        // segment as a bare title. Accept only when unique — ambiguous
        // titles stay dangling so we don't rewrite to the wrong folio.
        if (!targetId) {
          const last = token.ref.split("/").findLast(Boolean);
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
