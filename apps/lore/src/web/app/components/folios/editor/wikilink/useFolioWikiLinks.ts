import { useClient, useQuery, useStore } from "alepha/react";
import { useMemo } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import { currentFolioBlobsAtom } from "../../../../atoms/currentFolioBlobsAtom.ts";
import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import type { QuestRef } from "../../folioWikiLinkResolver.ts";
import { rewriteFolioWikiLinks } from "../../rewriteFolioWikiLinks.ts";
import type { WikiLinkSuggestion } from "./wikiLinkSuggestion.ts";

export interface FolioWikiLinks {
  /**
   * What the `[[` picker offers in Edit mode.
   */
  suggestions: WikiLinkSuggestion[];
  /**
   * `content` with `[[…]]` turned into real markdown links and
   * `assets/<name>` turned into `/api/files/<id>` — what View mode renders.
   *
   * The stored markdown is never touched: this is a display transform, so
   * an exported folio keeps the portable relative paths that make it a copy
   * rather than a transform.
   */
  rendered: string;
}

/**
 * Both halves of wiki-link support for the folio workspace, from one set of
 * lookups.
 *
 * They are one hook because they need exactly the same data and the quest
 * list costs a request. Splitting them fetched it twice.
 *
 * Deliberately NOT `useWikiLinkRewrite` (the reader-side hook the quest
 * description uses): that one fetches folios, directories and blobs itself,
 * because a quest page has none of them in memory. The folio workspace has
 * all three in atoms already — the tree pane is built from them — so
 * reusing it would add three round-trips per folio open to re-fetch what is
 * on screen.
 *
 * The quest fetch here is unconditional, unlike the reader-side hook's,
 * which skips it when the body has no `[[`: the picker has to be able to
 * offer a quest the moment the author types the second bracket, and that is
 * too late to start a round-trip. Cached under a project-wide key so
 * navigating between folios does not refetch.
 */
export const useFolioWikiLinks = (
  /**
   * Addresses the quest fetch, which is an API call on the integer id.
   */
  projectId: number | undefined,
  /**
   * Addresses the links the rewrite produces, which are URLs on the slug.
   * Neither identity substitutes for the other.
   */
  projectSlug: string | undefined,
  content: string,
): FolioWikiLinks => {
  const questApi = useClient<QuestController>();
  const [folios] = useStore(userFoliosAtom);
  const [directories] = useStore(projectDirectoriesAtom);
  const [blobs] = useStore(currentFolioBlobsAtom);

  const { data: quests } = useQuery<QuestRef[]>(
    {
      key: ["wikiLinkQuests", projectId ?? 0],
      enabled: projectId !== undefined,
      staleTime: [5, "minutes"],
      handler: async () => {
        if (projectId === undefined) return [];
        const page = await questApi.getQuests({
          params: { projectId },
          query: { size: 100, sort: "-updatedAt" } as never,
        });
        return (page.content as Array<{ shortId: number; title: string }>).map(
          (q) => ({ shortId: q.shortId, title: q.title }),
        );
      },
      onError: () => {},
    },
    [projectId, questApi],
  );

  const blobRefs = useMemo(
    () =>
      blobs.map((b) => ({
        fileId: b.id,
        shortId: b.shortId,
        name: b.name,
      })),
    [blobs],
  );

  /**
   * Ordering is folios, then quests, then files. The picker shows the first
   * eight matches, and a folio is what `[[` means when nothing qualifies it
   * — putting quests ahead of folios would bury the common case.
   */
  const suggestions = useMemo<WikiLinkSuggestion[]>(
    () => [
      ...folios.map((f) => ({
        key: `folio:${f.id}`,
        kind: "folio" as const,
        token: f.title,
        label: f.title,
        hint: `#${f.shortId}`,
      })),
      ...(quests ?? []).map((q) => ({
        key: `quest:${q.shortId}`,
        kind: "quest" as const,
        token: `quest#${q.shortId}`,
        label: q.title,
        hint: `#${q.shortId}`,
      })),
      ...blobs.map((b) => ({
        key: `blob:${b.id}`,
        kind: "blob" as const,
        token: `blob:#${b.shortId}`,
        label: b.name,
      })),
    ],
    [folios, blobs, quests],
  );

  const rendered = useMemo(
    () =>
      projectSlug === undefined
        ? content
        : rewriteFolioWikiLinks(
            content,
            projectSlug,
            folios as Folio[],
            quests ?? [],
            directories,
            blobRefs,
          ),
    [content, projectSlug, folios, quests, directories, blobRefs],
  );

  return { suggestions, rendered };
};
