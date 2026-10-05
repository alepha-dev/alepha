import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { splitMarkdownCode } from "../../web/app/components/shared/element/markdownCodeSegments.ts";
import { type FolioLink, folioLinks } from "../entities/folioLinks.ts";
import {
  ResourceRegistry,
  type ResourceRef,
} from "../resources/ResourceRegistry.ts";
import type { LinkSourceKind } from "../schemas/linkSourceKindSchema.ts";
import type { LinkTargetKind } from "../schemas/linkTargetKindSchema.ts";
import { BoundParameters } from "./BoundParameters.ts";

/**
 * A `[[#Q12]]` token, parsed. The letter names the kind and the number is
 * the per-project id that kind is addressed by: a folio's, quest's or
 * feedback item's `shortId`, an epic's or release's `number`.
 */
export interface ParsedToken {
  /**
   * The registered kind its letter names (`quest` for `Q`).
   */
  type: string;
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
 * Core's link graph: parse, resolve and persist the `[[#Q12]]` references
 * between resources, over `folio_links` (the table kept its name when it
 * became every resource's graph, #E75 #Q2610). `FolioController`,
 * `QuestService` and the epic controller call
 * {@link ResourceLinkService.syncLinks} on every write to keep it in step with
 * the body that was just stored.
 *
 * One grammar, since epic #32: `#<LETTER><integer>`, project-scoped. The
 * letter names a kind through the {@link ResourceRegistry}, so this service
 * reads no module's table: each kind resolves its own numbers and describes
 * its own rows. A letter no registered module claims is not a reference here:
 * no row is written for it, and the reader shows it as plain text. Anything
 * else between `[[` and `]]` is not a reference either, and the reader shows
 * it as a broken link rather than as prose, because a visible break beats a
 * silent one.
 *
 * The title, path, anchor and `blob:` forms that used to parse here, and the
 * five hundred lines that resolved them, went with the purge of epic #32
 * (quest #1808). An id needs no rewriter behind it: it survives a rename, a
 * move and a re-import unchanged.
 */
export class ResourceLinkService {
  /**
   * Maximum number of outbound `[[...]]` references parsed from a single
   * body. Hard ceiling so a pathological note can't blow up the link table
   * or the resolution query budget.
   */
  protected readonly MAX_LINKS_PER_FOLIO = 200;

  protected readonly links = $repository(folioLinks);
  protected readonly resources = $inject(ResourceRegistry);
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
    const typed = this.resources.parseReference(trimmed);
    if (!typed) return undefined;
    return { type: typed.kind, id: typed.number, raw: trimmed };
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
    source?: { kind: string; id: string },
  ): Promise<Array<{ targetType: LinkTargetKind; toId: string }>> {
    if (tokens.length === 0) return [];
    const maps = await this.buildLookupMaps(tokens, projectId);

    const seen = new Set<string>();
    const resolved: Array<{ targetType: LinkTargetKind; toId: string }> = [];
    for (const token of tokens) {
      const toId = maps.get(token.type)?.get(token.id);
      if (!toId) continue;
      // Self-link suppression is folio-only, as it always was: a folio's
      // `toId` is a UUID, and a quest naming its own number keeps its row.
      if (
        source?.kind === "folio" &&
        token.type === "folio" &&
        toId === source.id
      ) {
        continue;
      }
      const dedupKey = `${token.type}:${toId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      resolved.push({ targetType: token.type as LinkTargetKind, toId });
    }
    return resolved;
  }

  /**
   * Per kind, the per-project number → the value stored in
   * `folio_links.to_id`, read once per sync, for the kinds the tokens
   * actually name: a body with only `#Q` refs never reads folios. Each kind
   * resolves its own numbers.
   */
  protected async buildLookupMaps(
    tokens: ParsedToken[],
    projectId: number,
  ): Promise<Map<string, Map<number, string>>> {
    const numbers = new Map<string, number[]>();
    for (const token of tokens) {
      numbers.set(token.type, [...(numbers.get(token.type) ?? []), token.id]);
    }
    const maps = new Map<string, Map<number, string>>();
    for (const [kind, wanted] of numbers) {
      const resolve = this.resources.get(kind)?.resolveNumbers;
      maps.set(kind, resolve ? await resolve(projectId, wanted) : new Map());
    }
    return maps;
  }

  /**
   * Replace the set of outbound links of a source with the references parsed
   * from the supplied content. Idempotent.
   *
   * Not atomic, and there is no transaction to make it so (D1): a failure
   * between the delete and the insert leaves the source with fewer links
   * than its content names, until its next save re-syncs them. Callers run
   * it after their main write, through `BestEffort` (#Q2555).
   *
   * ⚠️ **Pass `created` on a create path.** The source id is brand new there,
   * so the DELETE below cannot match a row - it is one wasted statement on
   * every quest, epic and folio ever made, and on D1 a statement is a round
   * trip. It showed worst where creates are batched: a 31-row CSV import
   * spent 31 of its 226 statements on deletes that matched nothing (#Q2146).
   *
   * ⚠️ It is a CREATE flag, not a "there is nothing to insert" flag. The
   * update path needs the delete unconditionally, because previous links may
   * exist and the new body may carry none - that is exactly the edit that has
   * to remove them. Getting this wrong leaves a link the reader can still see
   * pointing at something the body no longer mentions.
   */
  public async syncLinks(
    source: LinkSource,
    content: string,
    opts: { created?: boolean } = {},
  ): Promise<void> {
    const fromId = String(source.id);
    const tokens = this.parseTokens(content);
    const targets = await this.resolveTokenIds(tokens, source.projectId, {
      kind: source.kind,
      id: fromId,
    });

    if (!opts.created) {
      await this.links.deleteMany({
        fromType: { eq: source.kind },
        fromId: { eq: fromId },
      });
    }

    if (targets.length === 0) return;

    // One multi-row INSERT, not one per target. This runs on EVERY folio
    // and quest write, and on D1 an insert is a round trip: a folio with
    // 20 wiki links used to pay 20 of them per save, and now pays one.
    //
    // ⚠️ `createMany` chunks by the driver's parameter ceiling (twenty of
    // these rows per statement on D1, since 2026-09-05: a folio with 28
    // links used to fail its save with `too many SQL variables`) and its
    // batches are not atomic on their own. That costs little here: this
    // delete-then-insert was never atomic on D1 either, and the next save
    // of the source re-syncs whatever a failure left out.
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
   * Delete the outbound links of many sources of one kind at once, in
   * batches: what a directory delete cascades away (#Q2550). `from_id` is
   * no foreign key, so nothing else clears them.
   */
  public async deleteLinksFromMany(
    kind: LinkSourceKind,
    ids: readonly (string | number)[],
  ): Promise<void> {
    for (const batch of this.bound.chunk(ids.map(String))) {
      await this.links.deleteMany({
        fromType: { eq: kind },
        fromId: { inArray: batch },
      });
    }
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
   * Display refs of one kind's target ids, through the kind's own module:
   * what a links list shows. An id nothing answers to is absent, and so is
   * every id of a kind no registered module owns.
   */
  public async describe(
    kind: string,
    projectId: number,
    ids: readonly (string | number)[],
  ): Promise<ResourceRef[]> {
    return this.resources.describe(kind, projectId, ids.map(String));
  }
}
