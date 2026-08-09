import { useClient, useQuery, useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useMemo } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { AppRouter } from "../../../../AppRouter.ts";
import { projectBlobsAtom } from "../../../../atoms/projectBlobsAtom.ts";
import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import {
  createFolioWikiLinkResolver,
  type QuestRef,
} from "../../folioWikiLinkResolver.ts";
import type {
  WikiLinkEditorContext,
  WikiLinkSuggestion,
} from "./wikiLinkPlugin.tsx";

/**
 * Everything the editor's wiki-link plugin needs, assembled from what the
 * folio route loaders already put in the atoms.
 *
 * Folios, directories and blobs cost nothing here — the tree pane is built
 * from the same three lists, so they are in memory before the editor mounts.
 * Quests are the one fetch, and unlike the reader-side `useWikiLinkRewrite`
 * it is NOT conditional on the body containing a `[[`: the `[[` picker has
 * to be able to offer a quest the moment the author types the second
 * bracket, which is too late to start a round-trip. It is cached under a
 * project-wide key so navigating between folios does not refetch.
 */
export const useWikiLinkEditorContext = (
  projectId: number | undefined,
): WikiLinkEditorContext | undefined => {
  const router = useRouter<AppRouter>();
  const questApi = useClient<QuestController>();
  const [folios] = useStore(userFoliosAtom);
  const [directories] = useStore(projectDirectoriesAtom);
  const [blobs] = useStore(projectBlobsAtom);

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

  return useMemo(() => {
    if (projectId === undefined) return undefined;
    const resolver = createFolioWikiLinkResolver({
      projectId,
      folios: folios as Folio[],
      quests: quests ?? [],
      directories,
      blobs: blobs.map((b) => ({
        fileId: b.fileId,
        shortId: b.shortId,
        name: b.name,
      })),
    });

    // Folios first, then quests, then files. The picker shows the first
    // eight matches, and a folio is what `[[` means when nothing qualifies
    // it — putting quests ahead of folios would bury the common case.
    const suggestions: WikiLinkSuggestion[] = [
      ...folios.map((f) => ({
        key: `folio:${f.id}`,
        kind: "folio" as const,
        // The title, not `#shortId`: a reference written by title survives
        // an export/import into another project, and reads in the source.
        token: f.title,
        label: f.title,
        hint: `#${f.shortId}`,
      })),
      ...(quests ?? []).map((q) => ({
        key: `quest:${q.shortId}`,
        kind: "quest" as const,
        // Quests go by number. Titles get rewritten as work is understood,
        // and a title-keyed reference silently breaks when they do —
        // whereas a folio's title IS its identity and gets renamed far less.
        token: `quest#${q.shortId}`,
        label: q.title,
        hint: `#${q.shortId}`,
      })),
      ...blobs.map((b) => ({
        key: `blob:${b.fileId}`,
        kind: "blob" as const,
        token: `blob:#${b.shortId}`,
        label: b.name,
      })),
    ];

    return {
      resolve: resolver.resolve,
      suggestions,
      navigate: (href: string) => {
        void router.push(href);
      },
    };
  }, [projectId, folios, directories, blobs, quests, router]);
};
