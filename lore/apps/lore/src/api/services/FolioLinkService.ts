import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { splitMarkdownCode } from "../../web/app/components/folios/markdownCodeSegments.ts";
import {
  parseTypedReference,
  type ReferenceKind,
} from "../../web/app/components/shared/element/typedReference.ts";
import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { type FolioLink, folioLinks } from "../entities/folioLinks.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import type { LinkSourceKind } from "../schemas/linkSourceKindSchema.ts";
import type { LinkTargetKind } from "../schemas/linkTargetKindSchema.ts";
import { BoundParameters } from "./BoundParameters.ts";

/**
 * A `[[#Q12]]` token, parsed. The letter names the kind and the number is
 * the per-project id that kind is addressed by: a folio's, quest's or
 * feedback item's `shortId`, an epic's or release's `number`.
 */
export interface ParsedToken {
  type: ReferenceKind;
  id: number;
  /**
   * The token as written, between the `[[` and `]]`.
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
 * Per kind, the per-project number → the value stored in
 * `folio_links.to_id`: a folio's UUID, every other kind's integer id as a
 * string. Read once per sync, for the kinds the tokens actually name.
 */
type TokenLookupMaps = Record<ReferenceKind, Map<number, string>>;

/**
 * Parse, resolve and persist the `[[#Q12]]` references between elements.
 * `FolioController`, `QuestService` and the epic controller call
 * {@link FolioLinkService.syncLinks} on every write to keep `folio_links` in
 * step with the body that was just stored.
 *
 * One grammar, since epic #32: `#<LETTER><integer>`, project-scoped, read
 * through `typedReference.ts`, the same module the browser resolver reads it
 * through. `Q` is a quest, `E` an epic, `F` a folio, `P` a feedback item,
 * `R` a release; the number is the id that kind is addressed by. Anything
 * else between `[[` and `]]` is not a reference: no row is written for it,
 * and the reader shows it as a broken link rather than as prose, because a
 * visible break beats a silent one.
 *
 * The title, path, anchor and `blob:` forms that used to parse here, and the
 * five hundred lines that resolved them, went with the purge of epic #32
 * (quest #1808). An id needs no rewriter behind it: it survives a rename, a
 * move and a re-import unchanged.
 */
export class FolioLinkService {
  /**
   * Maximum number of outbound `[[...]]` references parsed from a single
   * body. Hard ceiling so a pathological note can't blow up the link table
   * or the resolution query budget.
   */
  protected readonly MAX_LINKS_PER_FOLIO = 200;

  protected readonly folios = $repository(folios);
  protected readonly links = $repository(folioLinks);
  protected readonly quests = $repository(quests);
  protected readonly epics = $repository(epics);
  protected readonly feedbackRows = $repository(feedback);
  protected readonly releaseRows = $repository(releases);
  protected readonly bound = $inject(BoundParameters);

  /**
   * Extract `[[...]]` tokens from markdown content into structured
   * {@link ParsedToken}s. Stops at `this.MAX_LINKS_PER_FOLIO` matches so a
   * runaway note can't cost unbounded resolution work. Dedupes by kind and
   * number so the same token written twice produces one link.
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
   * Parse a single raw token body (between `[[` and `]]`). `undefined` for
   * anything that is not `#<LETTER><integer>`: a blank, a title, a path, a
   * `quest:` prefix or an anchor is not a reference and writes no row.
   */
  public parseToken(raw: string): ParsedToken | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const typed = parseTypedReference(trimmed);
    if (!typed) return undefined;
    return { type: typed.kind, id: typed.id, raw: trimmed };
  }

  /**
   * The identity of a token for dedup: same kind, same number. What
   * `parseTokens` dedupes on, so `[[#F12]]` and `[[#f12]]` are one link.
   */
  public tokenKey(token: ParsedToken): string {
    return `${token.type}:${token.id}`;
  }

  /**
   * Resolve a list of tokens into target rows scoped to the source's
   * project. Returns the deduped set of `{ targetType, toId }` pairs. A
   * folio's self-link is filtered out; a number nothing answers to is
   * dropped, and the reader shows it broken.
   */
  public async resolveTokenIds(
    tokens: ParsedToken[],
    projectId: number,
    sourceFolioId: string,
  ): Promise<Array<{ targetType: LinkTargetKind; toId: string }>> {
    if (tokens.length === 0) return [];
    const maps = await this.buildLookupMaps(tokens, projectId);

    const seen = new Set<string>();
    const resolved: Array<{ targetType: LinkTargetKind; toId: string }> = [];
    for (const token of tokens) {
      const toId = maps[token.type].get(token.id);
      if (!toId) continue;
      // Self-link suppression is folio-only because `toId` for a folio is a
      // UUID: comparing a quest's stringified integer against it can never
      // match anyway, so the check would be noise rather than a filter.
      if (token.type === "folio" && toId === sourceFolioId) continue;
      const dedupKey = `${token.type}:${toId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      resolved.push({ targetType: token.type, toId });
    }
    return resolved;
  }

  /**
   * Read the number → id table of every kind the tokens name, once. Two
   * columns per table, and a body with only `#Q` refs never reads folios.
   */
  protected async buildLookupMaps(
    tokens: ParsedToken[],
    projectId: number,
  ): Promise<TokenLookupMaps> {
    const kinds = new Set(tokens.map((t) => t.type));
    const where = { projectId: { eq: projectId } };
    const maps: TokenLookupMaps = {
      folio: new Map(),
      quest: new Map(),
      epic: new Map(),
      feedback: new Map(),
      release: new Map(),
    };
    if (kinds.has("folio")) {
      const rows = await this.folios.findMany({
        where,
        columns: ["id", "shortId"],
      });
      for (const r of rows) maps.folio.set(r.shortId, r.id);
    }
    if (kinds.has("quest")) {
      const rows = await this.quests.findMany({
        where,
        columns: ["id", "shortId"],
      });
      for (const r of rows) maps.quest.set(r.shortId, String(r.id));
    }
    // Epics and releases are addressed by their per-project `number`, NOT a
    // `shortId`: that is the column they carry, and what `/epics/:epicNumber`
    // and `#R12` both mean.
    if (kinds.has("epic")) {
      const rows = await this.epics.findMany({
        where,
        columns: ["id", "number"],
      });
      for (const r of rows) maps.epic.set(r.number, String(r.id));
    }
    if (kinds.has("feedback")) {
      const rows = await this.feedbackRows.findMany({
        where,
        columns: ["id", "shortId"],
      });
      for (const r of rows) maps.feedback.set(r.shortId, String(r.id));
    }
    if (kinds.has("release")) {
      const rows = await this.releaseRows.findMany({
        where,
        columns: ["id", "number"],
      });
      for (const r of rows) maps.release.set(r.number, String(r.id));
    }
    return maps;
  }

  /**
   * Replace the set of outbound links of a source with the references parsed
   * from the supplied content. Idempotent.
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
    // ⚠️ `createMany` chunks by the driver's parameter ceiling (twenty of
    // these rows per statement on D1, since 2026-09-05: a folio with 28
    // links used to fail its save with `too many SQL variables`) and its
    // batches are not atomic on their own. That costs nothing here —
    // `FolioController` wraps create/update in `$transactional()`, and this
    // delete-then-insert was never atomic without it.
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
}
