import { $repository } from "alepha/orm";
import { type FolioLink, folioLinks } from "../entities/folioLinks.ts";
import { type Folio, folios } from "../entities/folios.ts";

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

  /**
   * Extract `[[...]]` tokens from markdown content. Stops at `MAX_LINKS_PER_FOLIO`
   * matches so a runaway note can't cost unbounded resolution work.
   */
  public parseTokens(content: string): string[] {
    const out: string[] = [];
    if (!content) return out;
    const seen = new Set<string>();
    const re = /\[\[([^\]\n]+)\]\]/g;
    let match: RegExpExecArray | null = re.exec(content);
    while (match !== null) {
      const token = match[1].trim();
      if (token && !seen.has(token)) {
        seen.add(token);
        out.push(token);
        if (out.length >= MAX_LINKS_PER_FOLIO) break;
      }
      match = re.exec(content);
    }
    return out;
  }

  /**
   * Resolve a list of `[[...]]` tokens to folio ids in the same
   * (userId, campaignId) scope as the source folio. Returns the set of
   * unique target ids (excluding self-links).
   */
  public async resolveTokenIds(
    tokens: string[],
    userId: string,
    campaignId: number,
    sourceFolioId: string,
  ): Promise<string[]> {
    if (tokens.length === 0) return [];

    // Fetch the user's folios in the campaign in one pass; resolution is
    // in-memory after that. Bounded by per-user-per-campaign folio count.
    const candidates = await this.folios.findMany({
      where: {
        userId: { eq: userId },
        campaignId: { eq: campaignId },
      },
      columns: ["id", "shortId", "title"],
    });

    // Title → folio id map. Drop ambiguous titles (multiple folios with the
    // same case-folded title) — the author probably meant one of them but we
    // can't guess which.
    const titleMap = new Map<string, { id: string; count: number }>();
    for (const c of candidates) {
      const key = c.title.toLowerCase().trim();
      const existing = titleMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        titleMap.set(key, { id: c.id, count: 1 });
      }
    }

    const shortIdMap = new Map<number, string>();
    for (const c of candidates) shortIdMap.set(c.shortId, c.id);

    const resolved = new Set<string>();
    for (const token of tokens) {
      const targetId = this.resolveToken(token, titleMap, shortIdMap);
      if (targetId && targetId !== sourceFolioId) resolved.add(targetId);
    }
    return [...resolved];
  }

  /**
   * Resolve a single token. Split out so callers (or tests) can exercise
   * the matching rules without going through the DB roundtrip.
   */
  protected resolveToken(
    token: string,
    titleMap: Map<string, { id: string; count: number }>,
    shortIdMap: Map<number, string>,
  ): string | undefined {
    if (token.startsWith("#")) {
      const n = Number.parseInt(token.slice(1), 10);
      if (!Number.isFinite(n)) return undefined;
      return shortIdMap.get(n);
    }
    const hit = titleMap.get(token.toLowerCase().trim());
    if (!hit || hit.count > 1) return undefined; // unknown or ambiguous
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
    const targetIds = await this.resolveTokenIds(
      tokens,
      fromFolio.userId,
      fromFolio.campaignId,
      fromFolio.id,
    );

    await this.links.deleteMany({ fromId: { eq: fromFolio.id } });

    if (targetIds.length === 0) return;

    // One insert per target. Repository doesn't expose bulk insert in
    // a single call, and per-folio caps keep this loop small.
    for (const toId of targetIds) {
      await this.links.create({ fromId: fromFolio.id, toId });
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
   * Inbound links: folios that point TO this one (their content contains
   * a `[[...]]` that resolved here).
   */
  public async findInbound(toId: string): Promise<FolioLink[]> {
    return this.links.findMany({
      where: { toId: { eq: toId } },
    });
  }
}
