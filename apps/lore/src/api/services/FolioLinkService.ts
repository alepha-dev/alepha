import { $repository } from "alepha/orm";
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
  /** Target table — `folio` (default) or `quest`. */
  type: "folio" | "quest";
  /**
   * The reference body. `#N` means lookup by shortId; anything else
   * means lookup by title (case-insensitive). The leading `#` is
   * preserved so resolvers can pattern-match without splitting again.
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
 * Parse + resolve + persist wiki-style `[[link]]` references between
 * folios. Used by `FolioController` on every folio create/update to keep
 * `folio_links` in sync with the current content.
 *
 * Resolution rules (scoped to the calling user within the folio's
 * campaign — folios are per-user-per-campaign):
 * - `[[#12]]` matches the folio with `shortId = 12`.
 * - `[[Some title]]` matches by title, case-insensitive. If multiple
 *   folios share the title, the link is dropped (ambiguous).
 * - Unresolved references are silently ignored — the UI may surface them
 *   as plain italic to flag the dangling reference to the author.
 */
export class FolioLinkService {
  protected readonly folios = $repository(folios);
  protected readonly links = $repository(folioLinks);
  protected readonly quests = $repository(quests);

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

    let type: "folio" | "quest" = "folio";
    let body = trimmed;
    const colonIdx = body.indexOf(":");
    // A leading `#N` is a folio shortId — the `#` is NOT a type
    // separator. Only treat `something:rest` as typed if `something`
    // is a known prefix.
    if (colonIdx > 0) {
      const prefix = body.slice(0, colonIdx).trim().toLowerCase();
      if (prefix === "quest" || prefix === "folio") {
        type = prefix;
        body = body.slice(colonIdx + 1).trim();
      }
    }

    // Anchors are folio-only for v1. On a quest token, an embedded `#`
    // is the shortId separator (e.g. `quest#32`), NOT an anchor.
    let anchor: string | undefined;
    if (type === "folio") {
      // For `[[#42#zones]]` (shortId + anchor) the FIRST `#` is part of
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
   * source folio's (userId, campaignId). Returns the deduped set of
   * `{ targetType, toId }` pairs. Self-links are filtered out.
   *
   * Quests are campaign-scoped only (any campaign member sees the same
   * quest set); the userId filter is folio-specific.
   */
  public async resolveTokenIds(
    tokens: ParsedToken[],
    userId: string,
    campaignId: number,
    sourceFolioId: string,
  ): Promise<Array<{ targetType: "folio" | "quest"; toId: string }>> {
    if (tokens.length === 0) return [];

    const needsFolios = tokens.some((t) => t.type === "folio");
    const needsQuests = tokens.some((t) => t.type === "quest");

    // In-memory maps after at most two DB roundtrips. Bounded by the
    // per-(user, campaign) folio count and per-campaign quest count.
    const folioById = new Map<number, string>();
    const folioByTitle = new Map<string, { id: string; count: number }>();
    if (needsFolios) {
      const candidates = await this.folios.findMany({
        where: {
          userId: { eq: userId },
          campaignId: { eq: campaignId },
        },
        columns: ["id", "shortId", "title"],
      });
      for (const c of candidates) {
        folioById.set(c.shortId, c.id);
        const key = c.title.toLowerCase().trim();
        const existing = folioByTitle.get(key);
        if (existing) existing.count++;
        else folioByTitle.set(key, { id: c.id, count: 1 });
      }
    }

    const questById = new Map<number, number>();
    const questByTitle = new Map<string, { id: number; count: number }>();
    if (needsQuests) {
      const candidates = await this.quests.findMany({
        where: { campaignId: { eq: campaignId } },
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

    const seen = new Set<string>();
    const resolved: Array<{ targetType: "folio" | "quest"; toId: string }> = [];
    for (const token of tokens) {
      const targetId = this.resolveParsedToken(
        token,
        folioById,
        folioByTitle,
        questById,
        questByTitle,
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
  ): string | undefined {
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
    const hit = folioByTitle.get(token.ref.toLowerCase().trim());
    if (!hit || hit.count > 1) return undefined;
    return hit.id;
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
      fromFolio.userId,
      fromFolio.campaignId,
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
}
