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
import { buildFolioSearchText, folios } from "../entities/folios.ts";
import { projects } from "../entities/projects.ts";
import { questComments } from "../entities/questComments.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import type {
  ProjectReferenceConversion,
  ReferenceRowConversion,
} from "../schemas/referenceConversionReportSchema.ts";
import { BoundParameters } from "./BoundParameters.ts";
import { FolioHistoryService } from "./FolioHistoryService.ts";
import { FolioLinkService, type ParsedToken } from "./FolioLinkService.ts";

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
    options: { dryRun: boolean; byUserId: string },
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
    const resolved = await this.links.resolveTokensEach(allTokens, projectId);

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
    const outcomes = new Map<Source, Outcome>();
    for (const source of sources) {
      const outcome = this.rewrite(source.text, rewriter, source.folioId);
      if (outcome.tokens.length === 0 && outcome.unresolved.length === 0) {
        continue;
      }
      outcomes.set(source, outcome);
      rows.push({
        kind: source.kind,
        id: String(source.id),
        number: source.number,
        field: source.field,
        tokens: outcome.tokens,
        anchorsDropped: outcome.anchorsDropped,
        unresolved: outcome.unresolved,
      });
    }

    if (!options.dryRun) {
      await this.write(projectId, sources, outcomes, options.byUserId);
    }

    return {
      projectId,
      slug: project.slug ?? String(projectId),
      scanned: sources.length,
      rewritten: rows.filter((r) => r.tokens.length > 0).length,
      skippedProtected,
      anchorsDropped: rows.reduce((n, r) => n + r.anchorsDropped, 0),
      unresolved: rows.reduce((n, r) => n + r.unresolved.length, 0),
      rows,
    };
  }

  /**
   * Persist every changed body, grouped by row so a quest with two changed
   * fields is one update and one re-sync.
   */
  protected async write(
    projectId: number,
    sources: Source[],
    outcomes: Map<Source, Outcome>,
    byUserId: string,
  ): Promise<void> {
    const changed = sources.filter((s) => {
      const outcome = outcomes.get(s);
      return outcome !== undefined && outcome.tokens.length > 0;
    });
    const text = (s: Source): string => outcomes.get(s)?.content ?? s.text;

    for (const source of changed.filter((s) => s.kind === "folio")) {
      const row = await this.folios.findOne({
        where: { id: { eq: String(source.id) } },
      });
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
      );
    }

    const questIds = new Set(
      changed.filter((s) => s.kind === "quest").map((s) => Number(s.id)),
    );
    for (const questId of questIds) {
      const row = await this.quests.findOne({ where: { id: { eq: questId } } });
      if (!row) continue;
      const patch: Partial<
        Record<"description" | "note" | "completionMessage", string>
      > = {};
      for (const source of changed) {
        if (source.kind !== "quest" || Number(source.id) !== questId) continue;
        patch[source.field as keyof typeof patch] = text(source);
      }
      await this.quests.updateById(questId, patch);
      const next = { ...row, ...patch };
      await this.links.syncLinks(
        { kind: "quest", id: questId, projectId },
        [next.description, next.note, next.completionMessage]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    for (const source of changed.filter((s) => s.kind === "epic")) {
      const description = text(source);
      await this.epics.updateById(Number(source.id), { description });
      await this.links.syncLinks(
        { kind: "epic", id: Number(source.id), projectId },
        description,
      );
    }

    for (const source of changed.filter((s) => s.kind === "comment")) {
      await this.comments.updateById(Number(source.id), { body: text(source) });
    }

    for (const source of changed.filter((s) => s.kind === "release")) {
      await this.releases.updateById(Number(source.id), {
        description: text(source),
      });
    }
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
