import {
  type ElementReferenceSet,
  type ElementRef,
  referencedIds,
  formatReference,
  type AttachmentRef,
  type ElementReference,
} from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useMemo } from "react";

import type { FolioAttachmentController } from "@/api/controllers/FolioAttachmentController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { FolioTreeEntry } from "@/api/schemas/folioTreeEntrySchema.ts";

import { currentFolioAttachmentsAtom } from "../../atoms/currentFolioAttachmentsAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";

/**
 * The folios an element body can reference, and a folio's attachments,
 * registered by `KnowledgeShell` on core's `ElementReferenceRegistry` (#E75,
 * #Q2624).
 *
 * ## Where the folio list comes from depends on the element
 *
 * A `folio` element is only ever rendered inside the folios workspace, whose
 * route loader has already filled `userFoliosAtom` and
 * `currentFolioAttachmentsAtom`: the tree pane is built from them. Reading
 * the atoms there rather than fetching is what keeps opening a folio at one
 * request instead of four. Every other element is rendered somewhere those
 * atoms are empty, so it fetches.
 *
 * That is a data-SOURCE difference, not a capability one: both branches
 * produce the same links. It is keyed on `kind` rather than on "is the atom
 * non-empty", because an empty atom is also what a project with no folios
 * looks like.
 *
 * Every folio, not a page of 100 (#Q2510): the `[[` picker cannot suggest a
 * folio it was never sent. A folio the list does not hold is resolved by
 * number through the refs endpoint (#Q2355).
 */
export const useFolioReferences = (
  element: ElementRef,
  content: string,
): ElementReferenceSet => {
  const folioApi = useClient<FolioController>();
  const attachmentApi = useClient<FolioAttachmentController>();

  const [atomFolios] = useStore(userFoliosAtom);
  const [atomAttachments] = useStore(currentFolioAttachmentsAtom);

  const inFolioWorkspace = element.kind === "folio";
  const { projectId } = element;

  // Only an `assets/<name>` reference needs the attachment list.
  const hasAssets = /\]\(assets\//i.test(content);

  const namedFolioIds = useMemo(
    () => referencedIds(content, "folio"),
    [content],
  );

  // Fetched, not atom-read, only outside the folio workspace. `enabled`
  // does the gating so the hook order never changes between renders.
  const { data: fetchedFolios } = useQuery<FolioTreeEntry[]>(
    {
      key: ["elementLinks:folios", projectId],
      enabled: !inFolioWorkspace && projectId > 0,
      staleTime: [5, "minutes"],
      handler: async () =>
        await folioApi.tree({
          params: { projectId },
        }),
      onError: () => {},
    },
    [folioApi, projectId, inFolioWorkspace],
  );

  // Attachments hang off ONE folio, so an `assets/` reference is only
  // resolvable for a folio element. Outside the workspace that means
  // fetching by id; a quest or epic body's `assets/` path stays unresolved
  // rather than being looked up project-wide, which is not a thing.
  const { data: fetchedAttachments } = useQuery<AttachmentRef[]>(
    {
      key: ["elementLinks:attachments", String(element.id ?? "")],
      enabled: !inFolioWorkspace && hasAssets && element.id !== undefined,
      staleTime: [1, "minutes"],
      handler: async () => {
        const rows = await attachmentApi.listAttachments({
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
    [attachmentApi, element.id, inFolioWorkspace, hasAssets],
  );

  const folios = inFolioWorkspace ? atomFolios : (fetchedFolios ?? []);

  // Inside the workspace the tree atom is already in memory, so only the
  // folios it does not hold are asked for, and opening a folio that links
  // recent ones costs no request. Outside it the list is itself a fetch
  // still in flight, so every named folio is asked for rather than waiting
  // on it to learn which are missing.
  const missingFolioIds = useMemo(() => {
    if (!inFolioWorkspace) return namedFolioIds.join(",");
    const held = new Set(atomFolios.map((f) => f.shortId));
    return namedFolioIds.filter((id) => !held.has(id)).join(",");
  }, [namedFolioIds, inFolioWorkspace, atomFolios]);

  const { data: namedFolios } = useQuery<ElementReference[]>(
    {
      key: ["elementLinks:folio-refs", projectId, missingFolioIds],
      enabled: missingFolioIds !== "" && projectId > 0,
      staleTime: [5, "minutes"],
      keepPreviousData: true,
      handler: async () =>
        (
          await folioApi.listFolioRefs({
            params: { projectId },
            query: { shortIds: missingFolioIds },
          })
        ).map((f) => ({ number: f.shortId, title: f.title })),
      onError: () => {},
    },
    [folioApi, projectId, missingFolioIds],
  );

  return useMemo(
    () => ({
      refs: [
        ...folios.map((f) => ({ number: f.shortId, title: f.title })),
        ...(namedFolios ?? []),
      ],
      // Attachments are not offered: a file is embedded as
      // `![name](assets/<name>)` from the Attachments tab or by dropping it
      // into the editor, never through a wiki-link.
      suggestions: folios.map((f) => {
        const token = formatReference("folio", f.shortId);
        return {
          key: `folio:${f.id}`,
          kind: "folio",
          token,
          label: f.title,
          hint: token,
        };
      }),
      attachments: inFolioWorkspace
        ? atomAttachments.map((b) => ({
            fileId: b.id,
            shortId: b.shortId,
            name: b.name,
            size: b.size,
            mime: b.mimeType,
          }))
        : (fetchedAttachments ?? []),
    }),
    [
      folios,
      namedFolios,
      inFolioWorkspace,
      atomAttachments,
      fetchedAttachments,
    ],
  );
};
