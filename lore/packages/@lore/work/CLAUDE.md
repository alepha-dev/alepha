# CLAUDE.md: @lore/work

**Lore as Jira** (#E75, folio #F1356): quests, epics, releases, areas, the kanban, the roadmap and feedback. It imports `@lore/core` only (`check:conventions`, `scripts/lore-package-graph.ts`), and reaches the other modules only through a core registry or a core link. Read the repository's `CLAUDE.md` first, then `packages/@lore/core/CLAUDE.md`: the barrels, the registries this package fills, and the conventions every package shares.

## Layout

The source keeps the directory structure it had in `apps/lore/src` (`api/`, `mcp/`, `web/`, `testing/`), so the package's files import each other relatively; everything else reaches it through its barrels, `@lore/work/api`, `./mcp`, `./web`, `./schemas` and `./testing`, with the rules core's `CLAUDE.md` gives for keeping them cheap. A barrel exports only what something outside `src/` imports (the entries, another package, `apps/lore/test`, `apps/e2e`, this package's `test/`): a name that becomes needed outside is added to its barrel then, and nothing is re-exported in advance. Its three modules, `LoreWorkApi`, `LoreWorkMcp` and `LoreWorkWeb`, import core's module first, so booting one boots what it depends on; `LoreWorkWeb` injects its router, its shell and its project loader from `register()`, never through `services`.

## Tests

`test/` holds the specs whose subject is Work, and they boot `LoreWorkApi` (and `LoreWorkMcp`) alone, through `@lore/work/testing`: `WorkTestEntities` (core's bag plus the quest tables), `createTestQuest`, `createTestEpic`. A spec that needs another module registered is a scenario and lives in `apps/lore/test`.

Notable:

- `release-changelog.spec.ts`: the changelog reads what is ATTACHED to a release (`quests.releaseId`), not what completed inside a time window.
- `quest-csv-formatter.spec.ts`: the CSV export, read back through a test-only CSV reader (quest import was deleted in #E48).
- `project-reports.spec.ts`, `project-leave.spec.ts`, `quest-objective-history.spec.ts`, `quest-reminder.spec.ts`, `quest-feedback-link.spec.ts`, `my-feedback.spec.ts`, and `feedback-*.spec.ts` for the Feedback module (attachments, rate limits, `source` provenance).
- `user-deletion-hook.spec.ts`, **regression guard**: `UserDeletionHook` refuses `deleteMyAccount` while the account still owns projects, and the account survives the refusal. Load-bearing because `projects.createdBy` has **no foreign key**: deleting an owner cascades nothing and leaves a project failing `assertOwner` for everybody, which nothing in the schema or the migrations can catch. Also pins that the hook's message reaches the client as a 409 with its text intact.

## Routes

Defined in `src/web/app/WorkRouter.ts` (and the account page in `WorkAccountRouter.ts`). A module's project pages join `CoreRouter`'s `project` layout through `$pageProject` (`parent:`). Route names (the `$page` keys) are what `router.path(...)` / `router.push(...)` consume.

| Path                                   | Route name               | Page (lazy)                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/:projectSlug/quests`                 | `projectQuests`          | `project/ProjectQuestsTable.tsx`              | Quest list grouped by area. Its loader gates on the **Work** capability and fetches nothing else; a bare `/:projectSlug` no longer reaches it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/:projectSlug/kanban`                 | `projectKanban`          | `project/ProjectKanbanPage.tsx`               | The Kanban board. Its own route since epic #2 — full width, no quest log, its own sidebar entry. Gated on the `work.board` option for the entry, not for the route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/:projectSlug/kanban/:shortId`        | `projectKanbanCard`      | `project/ProjectKanbanCard.tsx`               | A card opened on the board — a child route of `projectKanban`, so the board stays mounted behind it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/:projectSlug/releases`               | `projectReleases`        | `project/releases/ProjectReleases.tsx`        | Every release in the project, one flat `DataTable`: state chip, tag, progress, date, and a row menu carrying the create entries for the next versions (labelled with the tag they create, offered only from the frontier row of each line by `releaseBumps.ts`, and opening `ReleaseCreateDialog` pre-filled rather than writing), Set as default / Clear default, and Delete (`useDeleteRelease.ts`, whose confirm names a published release's frozen record and a lost default), plus a bulk Delete over the checkbox selection. Open and released is a two-value FILTER rather than two sections, and the **default** release wears a second chip beside the state one (`ReleaseDefaultBadge`) because it is orthogonal to both states. Ordered by parsed tag (`api/releaseOrder.ts`), **never by `tag` as text and no longer by `number`** - semver does not sort as text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/:projectSlug/releases/:releaseTag`   | `projectRelease`         | `project/releases/ProjectRelease.tsx`         | One release: a full-width **plate** (tag, state chip, meta line, progress bar, Publish/Reopen) over **five tabs** - Overview, Contents, Flow, Changelog, Artifacts - bound to `?tab=` by `useDetailTab`. Flow (`ReleaseFlow.tsx`, laid out by `releaseFlowLayout.ts`) draws the attached epics as clusters of their own questlines with `epics.dependsOn` as the edges between them, from the same `contents` the shell fetched for Contents, under the questline's pan-and-zoom viewport; the layout's scroll region is off for it, as it is for the changelog. Its cards are links to the quest page, not the epic Flow's dialog: the rows it is drawn from are not full resources. Deliberately **not** `DetailLayout`: a release's identity is four facts wide, and the artifact table and epic cards want the frame. Editing is a dialog (`ReleaseEditDialog`), not an inline card. Artifacts reads the real registry since epic #18 (`GET /api/projects/:projectId/artifacts?tag=`), matched on **tag equality** with no join table and no foreign key - so retagging a release changes what it shows, which is what the edit sheet warns about. `releaseArtifactsPreview.ts` and its "Preview" chip are deleted. Addressed by its TAG (`/alepha/releases/0.28.0`), and the param is `releaseTag` for the reason `:epicNumber` is not `:number`. No loader: the project route already holds every release with its rollup in `currentReleasesAtom` |
| `/:projectSlug/reports/`               | `reportsOverview`        | `project/reports/ReportsOverview.client.tsx`  | Overview                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/:projectSlug/reports/quests`         | `reportsQuests`          | `project/reports/ReportsQuests.client.tsx`    | Quest analytics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/:projectSlug/reports/members`        | `reportsMembers`         | `project/reports/ReportsMembers.client.tsx`   | Per-member contribution (was Reports▸Party)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/:projectSlug/feedback`               | `projectFeedback`        | `project/feedback/ProjectFeedback.tsx`        | Owner inbox: triage bug/feature requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/:projectSlug/epics`                  | `projectEpics`           | `project/epics/ProjectEpics.tsx`              | Epic list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/:projectSlug/epics/:epicNumber`      | `projectEpic`            | `project/epics/ProjectEpic.tsx`               | Epic detail (param is the per-project `number`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/:projectSlug/quests/:shortId`        | `projectQuest`           | `project/quest/QuestView.tsx`                 | Quest detail (param is the integer `shortId`, not a UUID)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/:projectSlug/quests/:shortId/graph`  | `projectQuestGraph`      | `project/quest/QuestQuestline.tsx`            | One quest's questline, drawn with the same `Questline` map as the epic's Flow tab. ⚠️ A quest that belongs to an epic never renders here - the loader redirects to `/epics/:epicNumber?tab=flow`, since that map already exists beside the epic's own chrome. The route name and the `/graph` path are kept because they are links people hold                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/:projectSlug/settings/areas`         | `projectSettingsAreas`   | `…/ProjectSettingsAreasPage.tsx`              | Areas config                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/:projectSlug/settings/areas/:areaId` | `projectSettingsArea`    | `…/ProjectSettingsAreaPage.tsx`               | One area: rename, merge, delete. Param is the area's `id`, not its name — a rename must not change the URL under the person doing it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/:projectSlug/settings/work`          | `projectSettingsWork`    | `…/ProjectSettingsWorkPage.tsx`               | Quests > Features: the Work options that change behaviour (estimate, chrono, reminder, agentPrompts), tag colours, roadmap visibility. Siblings: `/work/board` (`projectSettingsBoard`, the kanban columns, its tab listed with `work.board`) and `/work/prompts` (`projectSettingsPrompts`, the prompt editors, listed with `work.agentPrompts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/:projectSlug/request`                | `projectFeedbackRequest` | `project/feedback/ProjectFeedbackRequest.tsx` | First-party feedback form (login required). Top-level, **not** nested under the `project` layout — no membership check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/:projectSlug/roadmap`                | `projectRoadmap`         | `project/roadmap/ProjectRoadmap.tsx`          | Open releases and the epics inside them, read only. Top-level and **unguarded**, for the same reason `projectFeedbackRequest` is: `/:projectSlug` carries `$secure()`, which member-gates its subtree AND puts it in CSR. This is the ONE page a crawler reaches, so it is also the one that server-renders real data - and the one with `stream: false`, so a slug nobody owns answers a real 404 instead of a soft one. Who may read it is `projects.roadmapVisibility`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/account/feedback`                    | `myFeedback`             | `account/feedback/MyFeedback.tsx`             | A reporter's own submissions across all projects, declared in `src/web/app/components/account/LoreAccountRouter.ts` via `$pageAccount`, not in `WorkRouter`. Detail is a drawer/sheet (`MyFeedbackEditSheet.tsx`), not a separate route — there is no per-feedback status page anymore. **The route name is deliberately still `myFeedback`**, not `accountFeedback`: it predates the `/account` migration and a `$page` rename is not typecheck-protected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## State atoms

Live in `src/web/app/atoms/`, filled by this module's `ProjectLoaderRegistry` entry or its own route loaders, and cleared on leave.

**Per-project (set by `project` route loader)**

- `currentAssignedQuestsAtom` — quests assigned to the viewer
- `currentReleasesAtom` — release list
- `currentFeedbackCountAtom` — pending-feedback badge for the project header
- `currentQuestCountAtom` — open-quests badge for the project header (new: Quests has no feature gate, unlike Blights/Feedback, so this badge is always on)
- `currentEpicCountAtom` — draft-epics badge. It exists because `countOpenQuests` applies the backlog gate, so quests inside a draft epic are left out of the Quests count and would otherwise be invisible in the sidebar
- `currentAreasAtom` — every area of the project, and the ONLY list the area pickers read. They used to read `project.areas`, a stored JSON array, which left ten production areas visible on the board and yet unselectable

**Per-resource (set by their route loaders)**

- `currentQuestAtom` — active quest detail
- `currentEpicAtom` - the open epic. It exists for the breadcrumb, which `ProjectView` renders one layer ABOVE the route: the layout only sees `epicNumber`, and a number is not a title. Same arrangement as `currentInstanceAtom`

**Cookie-persisted UI preferences**

Both are `persist: "cookie"`, not `localStorage`, and for the same reason: `ProjectView` decides these layouts during SSR, on first paint, where web storage does not exist. A localStorage-backed atom reads empty on the server, so the preference would lose one frame every load.

- `questLogCollapsedAtom` — whether the Quest Log pane is collapsed to its rail. Deliberately kept out of the deleted `questsViewAtom`, which is why it survived that atom's retirement
- `kanbanFiltersAtom` — the board's filter bar, remembered across navigation and deliberately NOT in the URL: a filter bar writes on every keystroke, which is the write-back half of #156 that made every sidebar link dead. Carries its `projectId` so filters never leak between projects

**Kanban ↔ Header communication (the pattern that needs explaining)**

- `kanbanReloadAtom` — bumped by the Header's create button (`ProjectActionsCreateButton.tsx`) to trigger a board reload

It lives in `atoms/kanbanReloadAtom.ts`.

## Kanban is a route again (epic #2)

The board is `projectKanban` at `/:projectSlug/kanban`, with its own sidebar entry. Between the 2026-08 rename and epic #2 it was a _mode_ of the Quests page — no URL, no entry, reachable only through the view bar, which is precisely why that bar had to be invented ("unreachable from the UI at all"). Restoring the route collapsed `ProjectView`'s `kanbanView` special case into the machinery Epics, Folios and Blights already use.

**A bare `/:projectSlug` always lands on the list.** Between 2026-08 and 2026-09-02 `project.defaultSurface` (`"list" | "kanban"`) could send it to the board through the `projectQuests` loader, owner-settable as "Open on the board" on the Kanban settings page. That setting, its write path and the redirect were removed with feedback #2066 ("not needed"). The column itself was dropped with #E74.

⚠️ **What #156 was, so it does not come back by another route.** #156 was a `useEffect` seeding `?view=` from `localStorage` during render: `useRouterState` is a global store, so it fired on the OUTGOING render of every navigation away, saw the _next_ route's empty query, and bounced the user straight back — every sidebar link was dead while the board was the stored view. A loader redirect (the removed `defaultSurface` one) runs once on entry and has no outgoing render to misread; a render-time effect never may. `quest.spec.ts`'s "leaving the board actually leaves it" still guards the history.

**`questsViewAtom` is deleted.** It was the cookie holding the view (`lor.quests.view`); a per-browser preference could not serve a kanban-first _team_, and an invited member inherited nothing. `defaultSurface` replaced it for a month, then went too. The `QuestsView` union now lives in `ProjectQuestsViewSwitcher.tsx`.

**Header ↔ board.** `ProjectActionsCreateButton` derives "on the board" from `routerState.name === "projectKanban"` (it used to need the route name _plus_ the stored view). After creating a quest from the header it bumps `kanbanReloadAtom`, which `KanbanBoard` watches to reload in place — which is why the board fetches itself rather than taking a route loader's data.

**The view bar is a convenience now, not the only door.** `ProjectQuestsViewSwitcher.tsx` is a two-entry horizontal bar across the **top of the project content area** — rendered by `ProjectView` as the first child of that area and _outside_ the `showQuestLog / fullWidth / else` branch, so it holds the same y-position in list and board view (#153, axis rotated by #163 — it was a vertical left rail until then). It used to live inside the Quests page, which necessarily put it _between_ the quest log and the table and made it read as a control for the table; no CSS inside the page could fix that, because a `NestedView`'s content is always right of the log. Its buttons **navigate** rather than write a preference, and it renders on `projectQuests`, `projectQuest` and `projectKanban` — dropping it on the detail route would shift the log up the moment a quest opened. On the detail route its `view` prop is `undefined`, so neither entry is pressed and both are live links back up to a list. Gated on the `work.board` option: with the board off it renders nothing rather than a single dead entry.

## QuestView Reusability

`QuestView` works in two contexts:

1. **Project page** — rendered as a route (`/:projectSlug/quests/:shortId`), reads from `currentProjectAtom`, navigates via router
2. **Kanban drawer** — rendered inside a `Drawer`, receives `onClose` and `onQuestChange` callbacks

When `onClose` is provided, it's used instead of router navigation. When `onQuestChange` is provided, it's called on quest mutations so the parent can update its state.

## QuestCreate Navigation

`QuestCreate` accepts an optional `onCreated` callback. When provided, it's called instead of the default `router.push("projectQuest", ...)` after creating a quest. Used by the header while the board is open, so creating a quest does not navigate off it.

## ⚠️ The roadmap is the one anonymous read path

`RoadmapController.getPublicRoadmap` (`GET /api/projects/by-slug/:slug/roadmap`)
is the **only `$action` in the application without `$secure()`**. Every other
one has it, `FeedbackController.submitFeedback` included: even the public
"report a bug" page requires sign-in, and the unguarded `/:projectSlug/request`
page exists to render a sign-in CTA rather than to accept anonymous writes.
`SigilIngestController` is a `$route` with its own bearer token, not an
exception to this.

Four properties hold it in place, and each is load-bearing:

- **Opt-in per project, off by default.** `projects.roadmapVisibility` is
  `off | members | public`, absent reads as `off`
  (`ProjectSecurityService.roadmapVisibilityOf`), and the one gate both
  audiences share is `isRoadmapVisible(project, user?)`.
- **Its own narrow response schema.** `roadmapResourceSchema` is built with
  `pick`, so exclusion is the default and a column added to `releases` or
  `epics` cannot ride along. `test/roadmap-public-endpoint.spec.ts` pins its
  exact key set and fails when a key is added.
- **`assertMember` is untouched.** Not widened, not bypassed, not made
  conditional. A diff that changes it while touching the roadmap is the wrong
  design.
- **404, never 403**, with one message for "no such slug" and "not public" -
  a 403 confirms the project exists.

Folio #1073 is the governing note: a public page must be a separate, narrow,
opt-in surface with its own response schema, never a relaxation of the
membership gate.

⚠️ **Turning a roadmap off is not instant, and that is disclosed rather than
fixed.** The response is publicly cacheable for 60 seconds (`max-age=60`,
`s-maxage=60`), and the members action reads the project row through the 30
second `$ownsProject` window. The settings card says so
(`project.settings.roadmap.delay`, "changes can take up to a minute to reach
visitors"), and the cache directives are pinned to that promise by a test -
raising either means changing that string in both locales first.

**The order between epics is drawn, not described.** `epics.dependsOn` is a
self-reference (`ON DELETE SET NULL`, optional, no column default), and the
roadmap sorts each release's epics so a predecessor comes above what depends
on it and renders an "After Epic N" chip. It replaced prose: "Depends on epic
#14 landing first" in a description cannot be rendered, sorted or checked.

⚠️ **It is a GATE since epic #31 (2026-09-04), like `quests.dependsOn`.**
It gates the START: the first quest of a `ready` epic is not accepted or
assigned while the predecessor is not `completed`
(`EpicWorkflowService.assertQuestWorkable`). Marking the dependent epic ready
is allowed, so a chain can be specified at once; that moved from Begin to the
start with #Q2223. It shipped advisory on 2026-09-01,
on the reasoning that epics overlap by design and a refusal would make people
stop setting the field; three days later the advisory channel had measured
zero (epic #27 was worked to 9 of 9 while `planned`, by an agent told the
status on every call), and the column comment now records both decisions.
`EpicDependencyService.spec.ts`'s test that was written to go red when the
gate arrived went red as designed and is its own opposite now. **Cycles ARE
refused** on write, which was always a different question: `A → B → A` is a
graph the roadmap cannot draw. The roadmap chip still says "After Epic N",
because it draws order and cannot see the predecessor's status; the epic
page says "Blocked by" off `dependsOnStatus`. MCP speaks in per-project
numbers (`dependsOn_number`, `0` clears), the HTTP API in ids, the same split
`quest_*` makes.

**An epic's status is the permission (epic #31), and only two of its four
statuses are set by hand (#Q2223).** `draft | ready | in_progress |
completed`: `setEpicStatus` moves between `draft` and `ready`, both ways,
and takes no other value; the first quest of a ready epic accepted or
assigned moves it to `in_progress` (`EpicWorkflowService.startIfReady`, which
also attaches the default release), and the request that completes or
shelves its last open quest moves it to `completed`
(`completeIfResolved`), which is terminal. Every rule lives on
`EpicWorkflowService`, once: a quest is accepted, assigned or completed only
while its epic is `ready` or `in_progress`; it enters, leaves or is deleted
only while the epic is `draft` or `ready` (no carve-out for completed
quests, by decision); a ready epic whose quests are all shelved stays ready.
Shelve and unassign are never refused by status, and unshelve is refused
only under `completed`. Folios attach in every status. The refusal strings
are the interface an agent reads, so they name the epic; a draft epic's
refusal deliberately does NOT tell the agent to mark it ready, since whether
a spec is done is the owner's call.

⚠️ It replaced epic #31's `planned | active | done` ratchet, whose Begin and
Conclude clicks carried no decision: the Work-on-it prompt told the agent to
make both, and on 2026-09-10 not one of project 1's 49 epics was `active`.
`active` and `done` were MIGRATED, not relabelled, and `activatedAt` became
`startedAt` (`20260910205427_epic_four_statuses`): the enum is validated on
read, so a row left holding a retired value fails every epic query, the
2026-08-05 shape. `test/epic-status-migration.spec.ts` applies that
migration to seeded rows. The pinned vocabulary folio (#1002) carries the
matrix in its first section.

⚠️ **`planned` became `draft` on 2026-09-11 (#Q2269)**, migrated rather than
relabelled, by `20260911141454_epic_draft_status`. That migration is
hand-written: drizzle generated a rebuild of `epics` to move the column
DEFAULT, and on D1 its `DROP TABLE` would have detached every quest and folio
from its epic. So the physical DEFAULT stays `'planned'` while the snapshot
says `'draft'`, accepted drift:
`EpicController.createEpic` is the only insert path and writes the status
itself. `test/epic-draft-migration.spec.ts` applies it to seeded rows. Why
the name: folio #1290.

⚠️ **A quest's status became `todo | in_progress | on_hold | shelved |
completed` the same day** (#Q2269), where it was `new | accepted | held |
shelved | completed`. The status is derived from timestamps, so no quest row
moved, but `20260911143021_quest_status_names` rewrites the stored copies of
the old values, which are validated on read: `projects.kanbanColumnConfig[*]
.status` (on the projects row, so a stale one fails every project read) and
the Active quests card's `statuses` in `project_dashboard_cards` and
`dashboard_cards`. `test/quest-status-migration.spec.ts` applies it to seeded
rows. `quests.history` keeps its action names (`assigned`, `held`), which are
events, not statuses. Labels go through `QUEST_STATUS_LABEL_KEYS`
(`questChips.ts`), never a key built from the status string.

⚠️ **Publishing a roadmap publishes the titles of epics nobody has
announced.** Draft epics are shown on purpose: an epic that is specified and
not started is exactly what a roadmap is for, and hiding it would make the
page useless for the one question it exists to answer. The safeguard is the
confirmation naming that outcome before the switch applies, not a filter in
the endpoint - a filter there would silently contradict the members page.

## Drag & Drop

Uses `@dnd-kit/core`. Cards are `useDraggable`, columns are `useDroppable`. Status transitions: `todo → in_progress → completed` (named `new → accepted → completed` until #Q2269, folio #1290). Completed quests cannot be moved back. A to-do quest must be accepted before completing.

## Feedback

User-submitted bug reports / feature requests that the project owner triages. (Renamed from **Petitions** in the 2026-08 great rename — same entity, same lifecycle, new name throughout code, DB, HTTP and MCP.)

**Lifecycle**: `pending → accepted` (promoted to one or more quests, each linked back via `quests.feedbackId` — there is no `promotedQuestId` column) `| rejected`.

**Submission flow (login required)** — both live entry points land on `POST /projects/:projectId/feedback`:

- `/:projectSlug/request` — first-party form on lore (`ProjectFeedbackRequest.tsx`, route `projectFeedbackRequest`). Anonymous visitors see a sign-in CTA. Once logged in, they get the full form (title, description, type bug/feature, file uploads).
- External "report a bug" buttons on third-party sites (`SigilFeedbackButton` in `@alepha/lore`, which opens the form with `window.open(target, "lore-feedback")`) point to `/:projectSlug/request?path=<encoded>&url=<encoded>&type=bug` — no screenshot capture, just a link. The page reads query params, persists them to `sessionStorage` (key `lor.feedback.draft.<projectSlug>` — renamed from `lor.petition.draft` in the same pass, unlike the storage bucket literals below, because this key is not a persisted external reference, just a transient client-side draft), cleans the URL via `history.replaceState`, and re-reads after the OAuth round-trip. Cleared on successful submit. `@alepha/lore` builds this same request URL client-side as `${sink}/${project}/request`, reading the project out of its own `SIGIL_KEY` (tokens are shaped `sg_<project>_<secret>`), so an enrolled app's "report a bug" widget links out to it. **That shape is an external contract**: third-party apps construct it themselves now, which is what let the config round trip disappear. It also means a project rename breaks every enrolled app's feedback link until each key is rotated, where before a re-poll healed it. Reporting itself is unaffected by a rename, and by a key that names no project at all: the sink resolves the project from the token's hash and never from anything the app declares. `packages/@alepha/lore/src/server/__tests__/SigilSinkProvider.spec.ts` asserts the shape; it is the only thing that caught the URL still being id-based after the slug migration.

**Reporter-facing views** — `/account/feedback` (`myFeedback`, own submissions across projects, detail in a drawer/sheet). There is no separate per-feedback status page (the old one was retired before this rename).

**Attachments**

- Uploaded one-at-a-time via `POST /projects/:projectId/feedback/attachments`. Returns a file id; the client collects ids and includes them in the feedback body.
- Allowed types: png/jpg/jpeg/webp/gif/csv/txt/json/xlsx/xls/pdf. Both MIME and extension are checked (neither alone is trustworthy).
- 5 MB / file, 10 / feedback item.
- Stored in the `petition-attachments` bucket (`alepha/api/files`) — **kept un-renamed on purpose**: it's a value already persisted on every existing `files` row, not just an in-code identifier. Renaming it would orphan every attachment ever uploaded (the bucket lookup would 404 for files stored under the old name). The same reasoning keeps the folio-blob bucket at `archive-blobs` (see Folios section) and the project-icon bucket at `campaign-icons` un-renamed. The feedback row carries `attachments: uuid[]` (mirrors `quests.attachments`).
- `assertAttachmentsBelongToUser` blocks cross-user file id reuse — the controller verifies every claimed attachment was uploaded by the same user.

**Rate limits — `feedbackOptionsAtom`** (lives in `src/api/atoms/`, server-only)

- `maxFeedbackPerUserPerDay: 5` — per user, across all projects. Applies only to non-members; project owners/members submit without limit.
- There is **no per-sigil cap**, and adding one is not a matter of wiring up a counter. `maxFeedbackPerSigilPerDay: 50` sat on the atom unread for months, described as capping a leaked sigil token; it was removed because it cannot be computed. A sigil token opens `POST /sigils/ingest` and nothing else, that route does not accept feedback (`absorb` never reads its own `gates.feedback`), and the only submission path requires a signed-in Lore account and carries no sigil identity - `source.sigilId` is optional exactly because the popup-redirect flow keeps the id server-side, and a browser-supplied one would be forgeable by the very caller the cap was for. `maxFeedbackPerUserPerDay` is what bounds a flood. See the atom's own docstring.
- `maxAttachmentsPerUserPerDay: 50` — per user, across all feedback.
- `maxAttachmentsPerFeedback: 10`, `maxFileSizeBytes: 5 MB`.
- All counts are DB-derived (no in-memory windows) so they survive restarts and are correct across workers.

**Visibility / access**

- Submit: any logged-in Lore user (no membership required), provided the project has the **Support** capability. Its switch on `/settings/capabilities` is the owner's opt-in/out lever.
- List/detail (read): any project member (`assertMember`). Triage — accept/reject/remove: project owner only (`assertOwner`). Same read-vs-mutate split applies to Blights and Insights (members can view the inbox / crash telemetry / analytics; owner-only actions stay gated).

**Where to look**

- Entity: `src/api/entities/feedback.ts`
- Controller: `src/api/controllers/FeedbackController.ts` (submitFeedback, feedbackContext, uploadFeedbackAttachment, listFeedback, getFeedback, getFeedbackAttachment, acceptFeedback, rejectFeedback, removeFeedback, listMyFeedback, listMyFeedbackProjects, updateMyFeedback, deleteMyFeedback)
- Rate limiter: `src/api/services/FeedbackRateLimiter.ts`
- Tunables atom: `src/api/atoms/feedbackOptionsAtom.ts`
- Inbox UI: `src/web/app/components/project/feedback/ProjectFeedback.tsx` (+ `ProjectFeedbackCard.tsx`, `ProjectFeedbackDetail.tsx`)
- Request UI: `src/web/app/components/project/feedback/ProjectFeedbackRequest.tsx`
- Routes: `projectFeedback` (under `project`), `projectFeedbackRequest` (top-level, not under the project layout — public landing), `myFeedback` (under the `/account` area, declared in `WorkAccountRouter`)

## Key dependencies

- `@dnd-kit/core` — drag & drop (kanban, quest board)

## Inventory

What this package holds, with the notes that are not obvious from the code. Moved from `apps/lore/CLAUDE.md` with the code (#E75); `yarn w lore inventory` prints the route table and the atoms from the live code.

**Controllers (9)** - `Feedback`, `FeedbackComment`, `Kanban`, `Release`, `Roadmap`, `ProjectQuestPortability`, `ProjectReports`, `Quest`, `QuestComment`.

**Entities (5)** - `feedback`, `feedbackComments`, `releases`, `questComments`, `quests`.

**Services (4)** - `FeedbackRateLimiter`, `QuestCsvFormatter`, `QuestResourceMapper`, `QuestService`.

**MCP tools (4)** - `EpicTools`, `FeedbackTools` (`feedback_comment_add`, plus the thread inlined on `feedback_get`), `ReleaseTools` (`release_list` / `_get` / `_create` / `_update` / `_publish` / `_reopen` / `_attach` / `_detach` / `_changelog` / `_delete`, every one naming the release by its TAG), `QuestTools` (`quest_comment_add`, `quest_objective_set`, `quest_unassign`, `quest_attachment_get` / `_add`, `quest_commit_add`, and the discussion inlined on `quest_get`).
