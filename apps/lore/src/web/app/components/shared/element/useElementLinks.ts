import { useClient, useQuery, useStore } from "alepha/react";
import { useMemo } from "react";

import type { BlobController } from "@/api/controllers/BlobController.ts";
import type { DirectoryController } from "@/api/controllers/DirectoryController.ts";
import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Folio } from "@/api/entities/folios.ts";

import { currentFolioBlobsAtom } from "../../../atoms/currentFolioBlobsAtom.ts";
import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { projectDirectoriesAtom } from "../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../atoms/userFoliosAtom.ts";
import type { WikiLinkSuggestion } from "../../folios/editor/wikilink/wikiLinkSuggestion.ts";
import type {
  BlobRef,
  DirectoryRef,
  EpicRef,
  FeedbackRef,
  QuestRef,
  ReleaseRef,
} from "../../folios/folioWikiLinkResolver.ts";
import { rewriteFolioWikiLinks } from "../../folios/rewriteFolioWikiLinks.ts";
import type { ElementRef } from "./elementRef.ts";
import { formatReference } from "./typedReference.ts";

export interface ElementLinks {
  /**
   * What the `[[` picker offers in Edit mode.
   */
  suggestions: WikiLinkSuggestion[];
  /**
   * `content` with `[[…]]` turned into real markdown links and
   * `assets/<name>` turned into `/api/files/<id>` — what View mode renders.
   *
   * The stored markdown is never touched: this is a display transform, so
   * an exported element keeps the portable relative paths that make it a
   * copy rather than a transform.
   */
  rendered: string;
}

/**
 * Both halves of wiki-link support — the picker's entries and the rendered
 * markdown — for ANY element, from one set of lookups.
 *
 * Replaces the two hooks that used to do this: `useFolioWikiLinks` (folio
 * workspace) and `useWikiLinkRewrite` (quest description). They resolved the
 * same syntax against the same tables and had drifted anyway — only the
 * folio one offered suggestions, so `[[` autocomplete existed on exactly one
 * surface while the syntax it inserts worked on three.
 *
 * ## Where the folio list comes from depends on the element
 *
 * A `folio` element is only ever rendered inside the folios workspace, whose
 * route loader has already filled `userFoliosAtom`, `projectDirectoriesAtom`
 * and `currentFolioBlobsAtom` — the tree pane is built from them. Reading
 * the atoms there rather than fetching is what keeps opening a folio at one
 * request instead of four. Every other element is rendered somewhere those
 * atoms are empty, so it fetches.
 *
 * That is a data-SOURCE difference, not a capability one: both branches feed
 * the same resolver and produce the same links. It is keyed on `kind` rather
 * than on "is the atom non-empty", because an empty atom is also what a
 * project with no folios looks like.
 *
 * Quests and epics are fetched on both branches, through `useQuery` with a
 * project-scoped key — so walking from a quest to a folio to an epic pays
 * for them once, not once per surface.
 */
export const useElementLinks = (
  element: ElementRef,
  content: string,
): ElementLinks => {
  const folioApi = useClient<FolioController>();
  const questApi = useClient<QuestController>();
  const epicApi = useClient<EpicController>();
  const directoryApi = useClient<DirectoryController>();
  const blobApi = useClient<BlobController>();
  const feedbackApi = useClient<FeedbackController>();

  const [atomFolios] = useStore(userFoliosAtom);
  const [atomDirectories] = useStore(projectDirectoriesAtom);
  const [atomBlobs] = useStore(currentFolioBlobsAtom);
  const [atomReleases] = useStore(currentReleasesAtom);

  const inFolioWorkspace = element.kind === "folio";
  const { projectId, projectSlug } = element;

  // Only path-style refs (`dir/sub/name`) need the directory map, only
  // `blob:` / `![](blob:…)` need the blob list, and only `[[#P120]]` needs
  // the feedback refs. All three are gated so a plain `[[#Q42]]` never pays
  // for them.
  const hasPathLinks = /\[\[[^\]\n]*\/[^\]\n]+\]\]/.test(content);
  const hasBlobRefs =
    /\[\[\s*blob:/i.test(content) || /!\[[^\]]*\]\(blob:/i.test(content);
  const hasFeedbackRefs = /\[\[\s*#p\d+\s*\]\]/i.test(content);

  // The inbox is paged, so a feedback item's title cannot be read off a
  // list the page already holds the way a release's can. Three columns for
  // the whole inbox, fetched only when a body names one.
  const { data: feedbackRefs } = useQuery<FeedbackRef[]>(
    {
      key: ["elementLinks:feedback", projectId],
      enabled: hasFeedbackRefs && projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () =>
        await feedbackApi.listFeedbackRefs({ params: { projectId } }),
      onError: () => {},
    },
    [feedbackApi, projectId, hasFeedbackRefs],
  );

  // Every release, with its number, tag and title, is already in the
  // project layout's atom, so `[[#R12]]` costs no request.
  const releases = useMemo<ReleaseRef[]>(
    () =>
      (atomReleases ?? []).map((r) => ({
        number: r.number,
        title: r.title,
        tag: r.tag,
      })),
    [atomReleases],
  );

  // Fetched, not atom-read, only outside the folio workspace. `enabled`
  // does the gating so the hook order never changes between renders.
  const { data: fetchedFolios } = useQuery<Folio[]>(
    {
      key: ["elementLinks:folios", projectId],
      enabled: !inFolioWorkspace && projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () =>
        await folioApi.list({
          query: { projectId, limit: 100 },
        }),
      onError: () => {},
    },
    [folioApi, projectId, inFolioWorkspace],
  );

  // Unconditional, unlike the reader-side fetch this replaces: the picker
  // has to offer a quest the moment the author types the second bracket,
  // and that is too late to start a round-trip.
  const { data: quests } = useQuery<QuestRef[]>(
    {
      key: ["elementLinks:quests", projectId],
      enabled: projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () => {
        const page = await questApi.getQuests({
          params: { projectId },
          // Direct addressing (design §5.3, "never gated") — a link into a
          // planned epic must still resolve, or the reader sees a literal
          // `[[…]]` token and the author cannot even create the link.
          query: {
            size: 100,
            sort: "-updatedAt",
            includePlanned: true,
          },
        });
        return page.content.map((q) => ({
          shortId: q.shortId,
          title: q.title,
        }));
      },
      onError: () => {},
    },
    [questApi, projectId],
  );

  const { data: epics } = useQuery<EpicRef[]>(
    {
      key: ["elementLinks:epics", projectId],
      enabled: projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () => {
        const rows = await epicApi.getEpics({ params: { projectId } });
        // `EpicRef.shortId` IS the epic's `number` — epics have no shortId.
        return rows.map((e) => ({ shortId: e.number, title: e.title }));
      },
      onError: () => {},
    },
    [epicApi, projectId],
  );

  const { data: fetchedDirectories } = useQuery<DirectoryRef[]>(
    {
      key: ["elementLinks:directories", projectId],
      enabled: !inFolioWorkspace && hasPathLinks && projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () =>
        await directoryApi.listAllDirectories({
          params: { projectId },
        }),
      onError: () => {},
    },
    [directoryApi, projectId, inFolioWorkspace, hasPathLinks],
  );

  // Blobs hang off ONE folio, so they are only resolvable for a folio
  // element. Outside the workspace that means fetching by id; a quest or
  // epic body's `blob:` ref stays unresolved rather than being looked up
  // project-wide, which is not a thing.
  const { data: fetchedBlobs } = useQuery<BlobRef[]>(
    {
      key: ["elementLinks:blobs", String(element.id ?? "")],
      enabled: !inFolioWorkspace && hasBlobRefs && element.id !== undefined,
      staleTime: [1, "minutes"],
      handler: async () => {
        const rows = await blobApi.listBlobs({
          params: { folioId: String(element.id) },
        });
        return rows.map((b) => ({
          fileId: b.id,
          shortId: b.shortId,
          name: b.name,
          size: b.size,
          mime: b.mimeType,
        }));
      },
      onError: () => {},
    },
    [blobApi, element.id, inFolioWorkspace, hasBlobRefs],
  );

  const folios = inFolioWorkspace ? atomFolios : (fetchedFolios ?? []);
  const directories = inFolioWorkspace
    ? atomDirectories
    : (fetchedDirectories ?? []);
  const blobs = useMemo<BlobRef[]>(
    () =>
      inFolioWorkspace
        ? atomBlobs.map((b) => ({
            fileId: b.id,
            shortId: b.shortId,
            name: b.name,
            size: b.size,
            mime: b.mimeType,
          }))
        : (fetchedBlobs ?? []),
    [inFolioWorkspace, atomBlobs, fetchedBlobs],
  );

  /**
   * Ordering is folios, then quests, then epics. The picker shows the first
   * eight matches and every entry inserts the same `#<LETTER><n>` shape, so
   * the order only says what a body most often points at: notes cite notes.
   * Epics come last because a project has far fewer of them, so they are
   * rarely what a prefix-free search is reaching for.
   *
   * Every token is the typed reference (`typedReference.ts`), shown again
   * as the hint so the author sees what will land in the document. A quest
   * used to be inserted as `quest#N`, without the colon both parsers needed
   * to select the type, so every quest link the picker ever wrote was a
   * broken folio reference (epic #32).
   *
   * Attachments are not offered. `[[blob:#N]]` is dead: a file is embedded
   * as `![name](assets/<name>)` from the Attachments tab or by dropping it
   * into the editor, never through a wiki-link.
   */
  const suggestions = useMemo<WikiLinkSuggestion[]>(
    () => [
      ...folios.map((f) => {
        const token = formatReference("folio", f.shortId);
        return {
          key: `folio:${f.id}`,
          kind: "folio" as const,
          token,
          label: f.title,
          hint: token,
        };
      }),
      ...(quests ?? []).map((q) => {
        const token = formatReference("quest", q.shortId);
        return {
          key: `quest:${q.shortId}`,
          kind: "quest" as const,
          token,
          label: q.title,
          hint: token,
        };
      }),
      ...(epics ?? []).map((e) => {
        const token = formatReference("epic", e.shortId);
        return {
          key: `epic:${e.shortId}`,
          kind: "epic" as const,
          token,
          label: e.title,
          hint: token,
        };
      }),
    ],
    [folios, quests, epics],
  );

  const rendered = useMemo(
    () =>
      projectSlug
        ? rewriteFolioWikiLinks(
            content,
            projectSlug,
            folios,
            quests ?? [],
            directories,
            blobs,
            epics ?? [],
            feedbackRefs ?? [],
            releases,
          )
        : content,
    [
      content,
      projectSlug,
      folios,
      quests,
      directories,
      blobs,
      epics,
      feedbackRefs,
      releases,
    ],
  );

  return { suggestions, rendered };
};
