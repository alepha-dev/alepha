import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { folioAssetPath } from "../../web/app/components/folios/folioAssetReference.ts";
import { splitMarkdownCode } from "../../web/app/components/folios/markdownCodeSegments.ts";
import {
  formatReference,
  isReferenceKind,
  type ReferenceKind,
} from "../../web/app/components/shared/element/typedReference.ts";
import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import { folioBlobs } from "../entities/folioBlobs.ts";
import {
  type Folio,
  buildFolioSearchText,
  folios,
} from "../entities/folios.ts";
import { projects } from "../entities/projects.ts";
import { questComments } from "../entities/questComments.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import type {
  ProjectReferenceConversion,
  ReferenceRowConversion,
} from "../schemas/referenceConversionReportSchema.ts";
import { BoundParameters } from "./BoundParameters.ts";
import { FolioHistoryService } from "./FolioHistoryService.ts";
import {
  FolioLinkService,
  type ParsedToken,
  type TokenLookupMaps,
} from "./FolioLinkService.ts";

/**
 * A row the converter read, with the one markdown field it is about.
 */
interface Source {
  kind: ReferenceRowConversion["kind"];
  id: string | number;
  number: number;
  field: string;
  text: string;
  /**
   * Set for a folio: the only source whose attachments can be addressed as
   * `assets/<name>`, since an attachment belongs to one folio.
   */
  folioId?: string;
}

interface BlobRow {
  fileId: string;
  shortId: number;
  name: string;
  folioId?: string | null;
}

interface Rewriter {
  resolve: (
    token: ParsedToken,
  ) => { kind: ReferenceKind; number: number } | undefined;
  resolveBlob: (ref: string) => BlobRow | undefined;
}

interface Outcome {
  content: string;
  tokens: ReferenceRowConversion["tokens"];
  anchorsDropped: number;
  unresolved: string[];
}

/**
 * The one-shot rewrite of every stored reference to the typed grammar of
 * epic #32 (quest #1807), run once against production between the deploy
 * that teaches both parsers the new form and the deploy that purges the
 * old one.
 *
 * ## Why it is a scan and not a link-table walk
 *
 * `rewriteTitleRefs` is driven by `findInbound`, so it reaches only sources
 * with a row in `folio_links`: never a comment (comments are never synced),
 * never a release (releases are not a link source), and never a body saved
 * before its sync path existed. This walks every row of the five sources
 * instead, the shape `tidyStalePaths` has.
 *
 * ## Why it does not go through the controllers
 *
 * `FolioController.update` is gated on project membership, and the operator
 * running this is not a member of every project on a public instance. The
 * folio write mirrors what that handler does for a content-only update: the
 * row, its search text, a revision (the per-folio undo), and the link
 * re-sync. Quests and epics are written through their repositories and
 * re-synced; comments and releases are never synced, so they are only
 * written. No history event is emitted: a hundred "description edited"
 * entries would say nothing a person wants to read.
 *
 * ## What it rewrites
 *
 * | stored | becomes |
 * |---|---|
 * | `[[Title]]`, `[[dir/path]]`, `[[folio:X]]`, `[[#12]]` | `[[#F12]]` |
 * | `[[quest:#12]]`, `[[quest:Title]]` | `[[#Q12]]` |
 * | `[[epic:#3]]`, `[[epic:Title]]` | `[[#E3]]` |
 * | `[[X#anchor]]` | the target form, anchor dropped and counted |
 * | `[[blob:#N]]`, `![alt](blob:#N)` | a link or embed of the attachment |
 * | unresolvable, ambiguous, an unknown blob | verbatim |
 * | anything inside a fence or code span | verbatim |
 *
 * A blob attached to the folio being rewritten becomes the `assets/<name>`
 * form the editor writes; anywhere else (another folio, a quest, an epic, a
 * comment, a release) it becomes the served `/api/files/<uuid>` URL, which
 * is what the renderer emitted for it, so nothing a reader sees changes.
 *
 * ## Why a write is paged
 *
 * The first production run (2026-09-05) wrote every changed row of every
 * project in one request. Each rewritten row re-read the project's folio,
 * quest and epic tables to re-sync its links, so on D1 the run took twenty
 * minutes over 161 folios and was cut off on the next one, with that row's
 * links deleted and not yet re-inserted. Now the lookup tables are read
 * once per project and handed to every re-sync, and a call writes at most
 * `limit` changed rows, reporting how many are left, so the operator's page
 * loops over short requests instead of holding one open for the whole job.
 * The scan is idempotent: a row written by an earlier call is no longer
 * changed, so the next call starts where the last one stopped.
 */
export class ReferenceConversionService {
  protected readonly projects = $repository(projects);
  protected readonly folios = $repository(folios);
  protected readonly quests = $repository(quests);
  protected readonly epics = $repository(epics);
  protected readonly releases = $repository(releases);
  protected readonly comments = $repository(questComments);
  protected readonly feedbackRows = $repository(feedback);
  protected readonly blobs = $repository(folioBlobs);
  protected readonly links = $inject(FolioLinkService);
  protected readonly history = $inject(FolioHistoryService);
  protected readonly bound = $inject(BoundParameters);

  public async convertProject(
    projectId: number,
    options: {
      dryRun: boolean;
      byUserId: string;
      /**
       * At most this many changed rows are written by one call; the rest
       * are reported as `remaining`. Omitted: every changed row.
       */
      limit?: number;
    },
  ): Promise<ProjectReferenceConversion> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    if (!project) throw new NotFoundError("Project not found");

    const where = { projectId: { eq: projectId } };
    const [
      folioRows,
      questRows,
      epicRows,
      releaseRows,
      feedbackRefs,
      blobRows,
    ] = await Promise.all([
      this.folios.findMany({ where }),
      this.quests.findMany({ where }),
      this.epics.findMany({ where }),
      this.releases.findMany({ where }),
      this.feedbackRows.findMany({ where, columns: ["id", "shortId"] }),
      this.blobs.findMany({
        where,
        columns: ["fileId", "shortId", "name", "folioId"],
      }),
    ]);
    const commentRows = await this.bound.collect(
      questRows.map((q) => q.id),
      (batch) =>
        this.comments.findMany({ where: { questId: { inArray: batch } } }),
    );

    // Every body, as one list, so the resolver reads each lookup table once.
    const sources: Source[] = [];
    let skippedProtected = 0;
    for (const f of folioRows) {
      if (f.protected) {
        skippedProtected++;
        continue;
      }
      sources.push({
        kind: "folio",
        id: f.id,
        number: f.shortId,
        field: "content",
        text: f.content ?? "",
        folioId: f.id,
      });
    }
    for (const q of questRows) {
      for (const field of [
        "description",
        "note",
        "completionMessage",
      ] as const) {
        const text = q[field];
        if (text) {
          sources.push({
            kind: "quest",
            id: q.id,
            number: q.shortId,
            field,
            text,
          });
        }
      }
    }
    for (const e of epicRows) {
      if (e.description) {
        sources.push({
          kind: "epic",
          id: e.id,
          number: e.number,
          field: "description",
          text: e.description,
        });
      }
    }
    for (const c of commentRows) {
      sources.push({
        kind: "comment",
        id: c.id,
        number: c.id,
        field: "body",
        text: c.body,
      });
    }
    for (const r of releaseRows) {
      if (r.description) {
        sources.push({
          kind: "release",
          id: r.id,
          number: r.number,
          field: "description",
          text: r.description,
        });
      }
    }

    const allTokens = sources.flatMap((s) => this.links.parseTokens(s.text));
    // One set of lookup tables for the whole project: the resolver reads it
    // here and every link re-sync of the write reuses it.
    const maps = await this.links.lookupMaps(allTokens, projectId);
    const resolved = await this.links.resolveTokensEach(
      allTokens,
      projectId,
      maps,
    );

    // The resolver answers with row ids; the typed form wants the number a
    // person types. One inverse map per kind, from the rows already read.
    const folioShortById = new Map(folioRows.map((f) => [f.id, f.shortId]));
    const questShortById = new Map(
      questRows.map((q) => [String(q.id), q.shortId]),
    );
    const epicNumberById = new Map(
      epicRows.map((e) => [String(e.id), e.number]),
    );
    const feedbackShortById = new Map(
      feedbackRefs.map((f) => [String(f.id), f.shortId]),
    );
    const releaseNumberById = new Map(
      releaseRows.map((r) => [String(r.id), r.number]),
    );
    const numberOf = (
      kind: ReferenceKind,
      toId: string,
    ): number | undefined => {
      switch (kind) {
        case "folio":
          return folioShortById.get(toId);
        case "quest":
          return questShortById.get(toId);
        case "epic":
          return epicNumberById.get(toId);
        case "feedback":
          return feedbackShortById.get(toId);
        case "release":
          return releaseNumberById.get(toId);
      }
    };
    const blobByShort = new Map(blobRows.map((b) => [b.shortId, b]));
    const blobByUuid = new Map(blobRows.map((b) => [b.fileId, b]));
    const rewriter: Rewriter = {
      resolve: (token) => {
        const hit = resolved.get(this.links.tokenKey(token));
        if (!hit || !isReferenceKind(hit.targetType)) return undefined;
        const number = numberOf(hit.targetType, hit.toId);
        return number == null ? undefined : { kind: hit.targetType, number };
      },
      resolveBlob: (ref) => {
        const trimmed = ref.trim();
        if (trimmed.startsWith("#")) {
          const n = Number.parseInt(trimmed.slice(1), 10);
          return Number.isFinite(n) ? blobByShort.get(n) : undefined;
        }
        return blobByUuid.get(trimmed);
      },
    };

    const rows: ReferenceRowConversion[] = [];
    const sourceOfRow = new Map<ReferenceRowConversion, Source>();
    const outcomes = new Map<Source, Outcome>();
    for (const source of sources) {
      const outcome = this.rewrite(source.text, rewriter, source.folioId);
      if (outcome.tokens.length === 0 && outcome.unresolved.length === 0) {
        continue;
      }
      outcomes.set(source, outcome);
      const row: ReferenceRowConversion = {
        kind: source.kind,
        id: String(source.id),
        number: source.number,
        field: source.field,
        tokens: outcome.tokens,
        anchorsDropped: outcome.anchorsDropped,
        unresolved: outcome.unresolved,
      };
      rows.push(row);
      sourceOfRow.set(row, source);
    }

    const isChanged = (s: Source): boolean =>
      (outcomes.get(s)?.tokens.length ?? 0) > 0;
    const changed = sources.filter(isChanged);
    const written = options.dryRun
      ? new Set<Source>()
      : await this.write(projectId, changed, outcomes, {
          byUserId: options.byUserId,
          limit: options.limit,
          maps,
          folioRows,
          questRows,
        });

    // A dry run reports every row a write would touch. A write reports the
    // rows it wrote this call and the rows no write ever touches (tokens
    // left verbatim, nothing to rewrite); a changed row left for the next
    // call is counted in `remaining` and shown when that call writes it.
    const reported = rows.filter((row) => {
      const source = sourceOfRow.get(row);
      if (!source) return false;
      return options.dryRun || written.has(source) || !isChanged(source);
    });

    return {
      projectId,
      slug: project.slug ?? String(projectId),
      scanned: sources.length,
      rewritten: options.dryRun ? changed.length : written.size,
      remaining: changed.length - written.size,
      skippedProtected,
      anchorsDropped: reported.reduce((n, r) => n + r.anchorsDropped, 0),
      unresolved: rows.reduce((n, r) => n + r.unresolved.length, 0),
      rows: reported,
    };
  }

  /**
   * Persist changed bodies, at most `limit` of them, grouped by row so a
   * quest with two changed fields is one update and one re-sync. The row is
   * the unit the page never splits, so a page may run a field past `limit`,
   * never a row. Rows are taken in a fixed order (folios, quests, epics,
   * comments, releases) so consecutive calls walk the project once.
   *
   * The rows come from the scan that produced `changed`, not from a second
   * read: nothing else writes these bodies while the operator's page loops,
   * and a read per row was a third of the first run's cost.
   */
  protected async write(
    projectId: number,
    changed: Source[],
    outcomes: Map<Source, Outcome>,
    options: {
      byUserId: string;
      limit?: number;
      maps: TokenLookupMaps;
      folioRows: Folio[];
      questRows: Quest[];
    },
  ): Promise<Set<Source>> {
    const { byUserId, maps } = options;
    const text = (s: Source): string => outcomes.get(s)?.content ?? s.text;
    const foliosById = new Map(options.folioRows.map((f) => [f.id, f]));
    const questsById = new Map(options.questRows.map((q) => [q.id, q]));
    const written = new Set<Source>();
    const budget = options.limit ?? Number.POSITIVE_INFINITY;
    const full = (): boolean => written.size >= budget;

    for (const source of changed.filter((s) => s.kind === "folio")) {
      if (full()) break;
      const row = foliosById.get(String(source.id));
      if (!row) continue;
      const content = text(source);
      const updated = await this.folios.updateById(row.id, {
        content,
        searchText: buildFolioSearchText({
          title: row.title,
          summary: row.summary,
          content,
        }),
      });
      await this.history.appendRevision(updated, byUserId, "edit");
      await this.links.syncLinks(
        { kind: "folio", id: row.id, projectId },
        content,
        maps,
      );
      written.add(source);
    }

    const questIds = [
      ...new Set(
        changed.filter((s) => s.kind === "quest").map((s) => Number(s.id)),
      ),
    ];
    for (const questId of questIds) {
      if (full()) break;
      const row = questsById.get(questId);
      if (!row) continue;
      const fields = changed.filter(
        (s) => s.kind === "quest" && Number(s.id) === questId,
      );
      const patch: Partial<
        Record<"description" | "note" | "completionMessage", string>
      > = {};
      for (const source of fields) {
        patch[source.field as keyof typeof patch] = text(source);
      }
      await this.quests.updateById(questId, patch);
      const next = { ...row, ...patch };
      await this.links.syncLinks(
        { kind: "quest", id: questId, projectId },
        [next.description, next.note, next.completionMessage]
          .filter(Boolean)
          .join("\n\n"),
        maps,
      );
      for (const source of fields) written.add(source);
    }

    for (const source of changed.filter((s) => s.kind === "epic")) {
      if (full()) break;
      const description = text(source);
      await this.epics.updateById(Number(source.id), { description });
      await this.links.syncLinks(
        { kind: "epic", id: Number(source.id), projectId },
        description,
        maps,
      );
      written.add(source);
    }

    for (const source of changed.filter((s) => s.kind === "comment")) {
      if (full()) break;
      await this.comments.updateById(Number(source.id), { body: text(source) });
      written.add(source);
    }

    for (const source of changed.filter((s) => s.kind === "release")) {
      if (full()) break;
      await this.releases.updateById(Number(source.id), {
        description: text(source),
      });
      written.add(source);
    }

    return written;
  }

  /**
   * One body through the rewrite table, prose segments only. Returns the
   * new text and what changed in it, so a dry run reports exactly what a
   * write would store.
   */
  protected rewrite(
    text: string,
    rewriter: Rewriter,
    sourceFolioId?: string,
  ): Outcome {
    const untouched: Outcome = {
      content: text,
      tokens: [],
      anchorsDropped: 0,
      unresolved: [],
    };
    if (!text.includes("[[") && !/\]\(blob:/i.test(text)) return untouched;

    const changes = new Map<string, ReferenceRowConversion["tokens"][number]>();
    const record = (before: string, after: string): void => {
      const key = `${before} ${after}`;
      const change = changes.get(key);
      if (change) change.count++;
      else changes.set(key, { before, after, count: 1 });
    };
    let anchorsDropped = 0;
    const unresolved: string[] = [];

    const blobUrl = (blob: BlobRow): string =>
      sourceFolioId && blob.folioId === sourceFolioId
        ? folioAssetPath(blob.name)
        : `/api/files/${blob.fileId}`;
    // A bracket in a link label would end the label early.
    const label = (name: string): string => name.replace(/[[\]]/g, "");

    const content = splitMarkdownCode(text)
      .map((segment) => {
        if (segment.code) return segment.text;
        return segment.text
          .replace(
            /!\[([^\]]*)\]\(blob:([^)\s]+)\)/gi,
            (whole, alt: string, ref: string) => {
              const blob = rewriter.resolveBlob(ref);
              if (!blob) {
                unresolved.push(whole);
                return whole;
              }
              const after = `![${alt || label(blob.name)}](${blobUrl(blob)})`;
              record(whole, after);
              return after;
            },
          )
          .replace(/\[\[([^\]\n]+)\]\]/g, (whole, body: string) => {
            const token = this.links.parseToken(body);
            if (!token) return whole;
            if (token.type === "blob") {
              const blob = rewriter.resolveBlob(token.ref);
              if (!blob) {
                unresolved.push(whole);
                return whole;
              }
              const after = `[${label(blob.name)}](${blobUrl(blob)})`;
              record(whole, after);
              return after;
            }
            const target = rewriter.resolve(token);
            if (!target) {
              unresolved.push(whole);
              return whole;
            }
            const after = `[[${formatReference(target.kind, target.number)}]]`;
            if (after === whole) return whole;
            if (token.anchor) anchorsDropped++;
            record(whole, after);
            return after;
          });
      })
      .join("");

    return {
      content,
      tokens: [...changes.values()],
      anchorsDropped,
      unresolved,
    };
  }
}
