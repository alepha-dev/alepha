import { useClient } from "alepha/react";
import { useEffect, useMemo, useState } from "react";
import type { BlobController } from "@/api/controllers/BlobController.ts";
import type { DirectoryController } from "@/api/controllers/DirectoryController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import {
  type BlobRef,
  type DirectoryRef,
  rewriteFolioWikiLinks,
} from "../folios/rewriteFolioWikiLinks.ts";

export interface WikiLinkRewriteResult {
  /** The rewritten markdown, ready for `MarkdownView`. */
  content: string;
  /** Folios fetched for resolution — also reusable for hover previews. */
  folios: Folio[];
  /** Quest summaries fetched for resolution. */
  questRefs: Array<{ shortId: number; title: string }>;
  /** Blobs fetched for resolution + `![alt](blob:#N)` rendering. */
  blobs: BlobRef[];
}

/**
 * Resolve `[[...]]` wiki-links in markdown into clickable links, scoped to a
 * project. Fetches the project's folios + quests once — but only when the
 * content actually contains a `[[` token — and feeds them to
 * {@link rewriteFolioWikiLinks}.
 *
 * Shared by the folio view and the quest description so both surfaces render
 * the same `[[#N]]` / `[[quest:#N]]` syntax identically. Unresolved or
 * link-free content is returned untouched (and skips the fetch entirely).
 *
 * The hook returns both the rewritten markdown AND the fetched lookups,
 * so callers that need to do something else with the data (e.g. the
 * hover-preview provider in the folio view) don't have to refetch.
 */
export const useWikiLinkRewrite = (
  content: string,
  /** Addresses the fetches below — every one of them is an API call. */
  projectId: number | undefined,
  /** Addresses the links the rewrite produces, which are URLs. */
  projectSlug: string | undefined,
  /**
   * The folio being rendered, when there is one. Attachments belong to a
   * single folio, so `blob:` references can only be resolved against it —
   * omitted (as the quest description does), blob refs stay unresolved
   * rather than being looked up project-wide, which is no longer a thing.
   */
  folioId?: string,
): WikiLinkRewriteResult => {
  const folioApi = useClient<FolioController>();
  const questApi = useClient<QuestController>();
  const directoryApi = useClient<DirectoryController>();
  const blobApi = useClient<BlobController>();
  const [folios, setFolios] = useState<Folio[]>([]);
  const [questRefs, setQuestRefs] = useState<
    Array<{ shortId: number; title: string }>
  >([]);
  const [directories, setDirectories] = useState<DirectoryRef[]>([]);
  const [blobs, setBlobs] = useState<BlobRef[]>([]);

  const hasLinks = content?.includes("[[") ?? false;
  // Only path-style refs need the directory map — bare `[[Title]]` and
  // `[[#42]]` resolve without it. Avoid the extra round-trip when the
  // content has no `dir/name` tokens.
  const hasPathLinks =
    hasLinks && /\[\[[^\]\n]*\/[^\]\n]+\]\]/.test(content ?? "");
  // `[[blob:…]]` or `![alt](blob:…)` — either triggers the blob fetch.
  const hasBlobRefs =
    /\[\[\s*blob:/i.test(content ?? "") ||
    /!\[[^\]]*\]\(blob:/i.test(content ?? "");
  const needsFetch = hasLinks || hasBlobRefs;

  useEffect(() => {
    if (!projectId || !needsFetch) return;
    let alive = true;
    Promise.all([
      // Both list endpoints cap their page size at 100 server-side —
      // request the max so wiki-link resolution sees as much as possible.
      hasLinks
        ? folioApi.list({ query: { projectId, limit: 100 } as never })
        : Promise.resolve([] as Folio[]),
      hasLinks
        ? questApi.getQuests({
            params: { projectId },
            query: { size: 100, sort: "-updatedAt" } as never,
          })
        : Promise.resolve({ content: [] } as {
            content: Array<{ shortId: number; title: string }>;
          }),
      hasPathLinks
        ? directoryApi.listAllDirectories({ params: { projectId } })
        : Promise.resolve([] as DirectoryRef[]),
      hasBlobRefs && folioId
        ? blobApi.listBlobs({ params: { folioId } })
        : Promise.resolve(
            [] as Array<{
              id: string;
              shortId: number;
              name: string;
              size: number;
              mimeType: string;
            }>,
          ),
    ])
      .then(([folioList, questResult, dirList, blobList]) => {
        if (!alive) return;
        setFolios(folioList as Folio[]);
        setQuestRefs(
          (
            questResult.content as Array<{ shortId: number; title: string }>
          ).map((q) => ({
            shortId: q.shortId,
            title: q.title,
          })),
        );
        setDirectories(dirList as DirectoryRef[]);
        setBlobs(
          (
            blobList as Array<{
              id: string;
              shortId: number;
              name: string;
              size: number;
              mimeType: string;
            }>
          ).map((b) => ({
            fileId: b.id,
            shortId: b.shortId,
            name: b.name,
            size: b.size,
            mime: b.mimeType,
          })),
        );
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [projectId, needsFetch, hasLinks, hasPathLinks, hasBlobRefs]);

  const rewritten = useMemo(() => {
    if (!projectId || !projectSlug || !needsFetch) return content ?? "";
    return rewriteFolioWikiLinks(
      content ?? "",
      projectSlug,
      folios,
      questRefs,
      directories,
      blobs,
    );
  }, [
    content,
    projectId,
    projectSlug,
    needsFetch,
    folios,
    questRefs,
    directories,
    blobs,
  ]);

  return { content: rewritten, folios, questRefs, blobs };
};
