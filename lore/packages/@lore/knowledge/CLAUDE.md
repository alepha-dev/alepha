# CLAUDE.md: @lore/knowledge

**Lore as Obsidian** (#E75, folio #F1356): folios, their directories, attachments, revisions and names. It imports `@lore/core` only (`check:conventions`, `scripts/lore-package-graph.ts`), and reaches the other modules only through a core registry or a core link. Read the repository's `CLAUDE.md` first, then `packages/@lore/core/CLAUDE.md`: the barrels, the registries this package fills, and the conventions every package shares.

## Layout

The source keeps the directory structure it had in `apps/lore/src` (`api/`, `mcp/`, `web/`, `testing/`), so the package's files import each other relatively; everything else reaches it through its barrels, `@lore/knowledge/api`, `./mcp`, `./web`, `./schemas` and `./testing`, with the rules core's `CLAUDE.md` gives for keeping them cheap. Its three modules, `LoreKnowledgeApi`, `LoreKnowledgeMcp` and `LoreKnowledgeWeb`, import core's module first, so booting one boots what it depends on; `LoreKnowledgeWeb` injects its router, its shell and its project loader from `register()`, never through `services`.

## Tests

`test/` holds the specs whose subject is Knowledge, and they boot `LoreKnowledgeApi` (and `LoreKnowledgeMcp`) alone, through `@lore/knowledge/testing`: `KnowledgeTestEntities` (core's bag plus `folios` and `folio_directories`), `createTestFolio`, `filedEpicOf`. An epic's filing lives in core's link graph, so a spec reads it with `filedEpicOf`, never a column. A spec that needs Work registered is a scenario and lives in `apps/lore/test`.

## Routes

Defined in `src/web/app/KnowledgeRouter.ts. A module's project pages join `CoreRouter`'s `project`layout through`$pageProject` (`parent:`). Route names (the `$page`keys) are what`router.path(...)`/`router.push(...)` consume.

| Path                               | Route name                 | Page (lazy)                          | Notes                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | -------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/:projectSlug/folios`             | `projectFolios`            | `folios/FoliosLayout.tsx`            | The workspace with nothing open — tree + "no folio open" pane. The directory table (`FolioBrowser`) and its Recent Activity panel were deleted here: the tree is the only navigation now. Blob/activity ENDPOINTS are untouched, so blob support can return to the workspace without a server change |
| `/:projectSlug/folios/new`         | `projectFoliosNew`         | `folios/FolioCreatePage.tsx`         | New folio                                                                                                                                                                                                                                                                                            |
| `/:projectSlug/folios/:shortId`    | `projectFoliosFolio`       | `folios/editor/FolioWorkspace.tsx`   | Folio workspace — always-editable, summary/body, auto-saved. The old read-only `FolioView` + separate `/edit` route (`projectFoliosFolioEdit`) were merged into this one surface and the `/edit` route was deleted, not redirected                                                                   |
| `/:projectSlug/settings/knowledge` | `projectSettingsKnowledge` | `…/ProjectSettingsKnowledgePage.tsx` | Folios > Features: the Knowledge option `agentSummary`                                                                                                                                                                                                                                               |

## State atoms

Live in `src/web/app/atoms/`, filled by this module's `ProjectLoaderRegistry` entry or its own route loaders, and cleared on leave.

**Per-resource (set by their route loaders)**

- `currentFolioAttachmentsAtom` — that folio's attachments. Folio-scoped, not project-scoped, since attachments stopped being rows in the folio tree

**Folios index (set by the `projectFolios` loader)**

- `userFoliosAtom`
- `projectDirectoriesAtom` — folio directory tree
- `folioTreeSeedAtom` — which project the two lists above currently hold, and when. Written by `KnowledgeRouter.seedFolioTree` and read by nothing else: without it, entering `/folios/:shortId` from outside ran the layout loader and the route loader back to back, in separate ticks, so the duplicate could not even be folded into the client's batch window

> `folioTagsAtom` and `currentFolioContentsAtom` are **gone** — the first with the tag feature (feedback #62), the second with the directory table the workspace replaced.

## Folios are this project's memory for Claude

Folios are markdown notes scoped to a **project** and shared across all its members (they were per-user before quest #65) — they mirror the `~/.claude/projects/*/memory/MEMORY.md` pattern but at the project level: persistent across sessions, exportable, fully MCP-readable. Treat them as the canonical place where any agent working on a Lore project should look for context and write down what it learns.

Since the 2026-08 great rename, Folios also absorbed the standalone **Archive** module — the directory tree + binary blobs that used to have their own URL path, entities (`archiveDirectories`/`archiveBlobs`/`archiveNames`) and MCP tool class (`ArchiveTools`). Folios live in a directory tree rather than nesting under each other. `folioDirectories` is the tree (depth-capped at 8), `folioAttachments` holds binary attachments, and `folioNames` backs name-uniqueness. `folios.directoryId` is `undefined` for the project root and **cascades on directory delete** — removing a directory removes everything in it, folios included. Surfaced at `/:projectSlug/folios` and over MCP via `FolioTools` (`directory_*`, `folio_attachment_*` tools live in this same file now).

**Conventions** (apply when curating folios — yourself or via Claude):

- One topic per folio. The title is the topic and the `summary` is the taxonomy — folios carry no tags (the tag feature was removed in feedback #62, and `folios.tags` dropped with #E74). Say what kind of note it is in the summary's first clause, since that is the line `project_context` shows.
- Keep folios short and self-contained. A folio that needs scrolling is two folios.
- When an agent creates a folio via MCP, it should always provide a `summary` (1-2 sentences, ~200 chars) so future `folio_list` / `folio_search` calls stay precise and `project_context` returns a self-explanatory index. It is the only orientation field there is now. Web-created folios may leave `summary` empty — the index falls back to the title.
- Cross-link with the typed grammar of epic #32, and nothing else: `[[#F12]]` a folio, `[[#Q12]]` a quest, `[[#E3]]` an epic, `[[#P120]]` a feedback item, `[[#R12]]` a release, the number being the per-project id. A title, a path, a `quest:` prefix or a `#anchor` between the brackets is not a reference and renders as a broken link. Links re-sync on every save; agents see them as `links.outbound` / `links.inbound` on `folio_get` and humans see them in the Links tab of the inspector.

**MCP orientation flow** (every AI client should follow this on a fresh task):

1. `project_context` — one-shot orientation: project metadata + active quests + folio index (~2K tokens, no folio bodies).
2. `folio_get` / `quest_get` on the specific entries that look relevant.
3. `folio_create` / `folio_update` when the agent decides something worth remembering long-term.
4. A folio that belongs to an epic is filed with `epic_number` on `folio_create` / `folio_update` (0 detaches), exactly like quests. `epic_get` lists the attached folios, `folio_list` takes an `epic` filter, and every folio row carries its `epic` ref. A design folio left unattached is how an epic's Folios tab ends up reading 0.

The MCP tool descriptions in `src/mcp/tools/ProjectTools.ts` and `src/mcp/tools/FolioTools.ts` are the public-facing version of this convention — every Claude reads them on connect. Keep them sharp.

**Where to look**

- Entity: `src/api/entities/folios.ts` (project-scoped, `searchText` blob for cheap LIKE search — blank for protected folios, `summary` for agent-readable orientation)
- Attachment / directory entities: `src/api/entities/folioAttachments.ts`, `folioDirectories.ts`, `folioNames.ts`
- Link table: `src/api/entities/folioLinks.ts` (derived; re-synced from `[[...]]` references on every folio save)
- Link sync: `src/api/services/ResourceLinkService.ts`
- Attachment / directory services: `src/api/services/FolioAttachmentService.ts`, `FolioDirectoryService.ts`, `FolioNameService.ts`
- Controller: `src/api/controllers/FolioController.ts` (list, listFolioRefs, getByShortId, get, getLinks, create, update, delete, listProjectActivity, listHistory, revertHistory, pinHistory)
- Directory / attachment controllers: `src/api/controllers/DirectoryController.ts`, `src/api/controllers/FolioAttachmentController.ts`
- History: `src/api/services/FolioHistoryService.ts` (append, retention sweep, protection-domain purge)
- MCP tools: `src/mcp/tools/FolioTools.ts` (folio, directory and attachment tools) + `ProjectTools.ts` (`project_context`)
- UI: `src/web/app/components/folios/editor/FolioWorkspaceShell.tsx` (the tree, the pane state and the menubar slot, mounted by `FoliosLayout` so they survive a folio switch, which remounts the page below since #Q2349) around `FolioWorkspace.tsx` (the document side; the workspace has three panes: folio tree (`editor/tree/`), document (`editor/document/`), inspector (`editor/inspector/` — Outline / History / Links tabs, the History and Links tabs absorbed the old `FolioHistoryPanel.tsx` / `FolioBacklinksPanel.tsx`, both deleted)), `FolioBrowser.tsx` and `FolioProtectedView.tsx` are both deleted — the browser with the directory view, the protected view as a long-standing orphan the workspace's own locked-folio gate had already replaced. Pane visibility, the 1280/1024px drawer breakpoints and focus mode (⌘.) live in `editor/useFolioPanes.ts`; find-in-folio (⌘F) in `editor/document/useFolioFind.ts`, which paints through the CSS Custom Highlight API (`::highlight(folio-find)` in `src/main.css`) rather than injecting `<mark>` elements — View mode's DOM is derived from the markdown on every render, so an injected node is discarded (and under the old Lexical body it would have been saved into the folio). ⚠️ **⌘F has two implementations**: `useFolioFind` serves VIEW mode only; in Edit mode `useFolioShortcuts` stands aside so `@codemirror/search` handles it, because CodeMirror virtualizes its viewport and a text-node walk silently misses every match scrolled out of sight. It is also keyed on the _rewritten_ content (`useFolioWikiLinks().rendered`), not the raw draft — the rewrite changes when the async quest fetch lands, replacing the pane's text nodes under any range the hook is holding
- E2E: `e2e/folio-workspace.spec.ts` is the whole folio surface now (summary round-trip, inspector tabs, tree drag-move, find, focus mode, pane persistence, the empty `/folios`, creating from the tree). `e2e/folios.spec.ts` was deleted with the directory table it drove. A tree drag is a fire-and-forget `update` — arm `waitForResponse` BEFORE the drop, or navigating cancels it in flight and the drop looks like it did nothing

**Bucket literals kept un-renamed** — `FOLIO_ATTACHMENT_BUCKET = "archive-blobs"` (`FolioAttachmentService.ts`, `LoreFileAccessProvider.ts`, `FolioAttachmentController.ts`, `useFolioImageUpload.ts`). Same reasoning as the `petition-attachments` bucket in the Feedback section: it's a value already persisted on every existing `files` row, and renaming it would orphan every folio image/blob ever uploaded.

### ⚠️ Protected folios: the protection-domain invariant

A folio with `protected: true` stores a client-side `BrowserCryptoProvider` envelope in `content`. The server never sees the passphrase or the plaintext.

**Invariant: `folio_revisions` never holds a snapshot from a different protection domain than the folio's current one.** Crossing the boundary in either direction purges the folio's revision history (`FolioHistoryService.purgeRevisions`, called from `FolioController.update` when `isProtected !== existing.protected`).

This is a **confidentiality requirement**, not a tidiness one. Before it existed, encrypting a folio blanked `searchText` and wiped the outbound links but left every pre-encryption plaintext snapshot in `folio_revisions` — readable by any project member through `GET /folios/:id/history`. Encrypting protected nothing already written. It also meant `revertHistory` could write a plaintext snapshot into a folio still flagged `protected`, leaving it undecryptable in the UI.

`pinned` revisions are exempt from the retention sweep but **not** from this purge. Regression guard: `test/folio-protected-history.spec.ts`.

**`FolioController.update` refuses both ways of crossing the boundary without saying what is crossing it.** The server cannot re-encode `content` itself, so the caller has to be the one that keeps the flag and the bytes in the same domain, and there are two ways to fail at it:

- **`content` without `protected`, on a protected row.** A stale tab writing its plaintext buffer. Refused since the workspace's Save action landed.
- **`protected` without `content`.** Refused since 2026-08-28. `content` falls back to `existing.content`, so the row keeps a value from the domain it just left. Turning protection ON this way is the serious direction: the folio holds readable plaintext while every signal around it agrees it is encrypted (`searchText` blanked, outbound links wiped, the editor offering a passphrase prompt), and `purgeRevisions` has just deleted the history, so there is nothing to recover from. Turning it OFF is the cheap direction, publishing the raw envelope as markdown.

Restating the state a folio is already in is not a crossing and stays allowed, so a rename, a move or a pin may still assert it. The web client always sends both fields together, so this only ever closed the API path. Regression guard: `test/folio-protected-update-guard.spec.ts`.

## Inventory

What this package holds, with the notes that are not obvious from the code. Moved from `apps/lore/CLAUDE.md` with the code (#E75); `yarn w lore inventory` prints the route table and the atoms from the live code.

**Controllers (3)** - `Directory`, `Folio`, `FolioAttachment`.

**Entities (5)** - `folioAttachments`, `folioDirectories`, `folioNames`, `folioRevisions`, `folios`.

**Services (5)** - `FolioAttachmentService`, `FolioDirectoryService`, `FolioHistoryService`, `FolioNameService`, `PinnedFolioFolder`.

**MCP tools (1)** - `FolioTools` (absorbed the old `ArchiveTools`: `directory_*` / `folio_attachment_*` live here now).
