import { Button, useDialog } from "@alepha/ui";
import { DetailLayout, type DetailTab, useDetailTab } from "@alepha/ui/shell";
import {
  useAction,
  useAlepha,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  BookOpen,
  FileText,
  History,
  Pencil,
  Swords,
  Workflow,
} from "lucide-react";
import { useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentEpicAtom } from "@/web/app/atoms/currentEpicAtom.ts";
import { currentEpicCountAtom } from "@/web/app/atoms/currentEpicCountAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ProjectActivityPage from "../activity/ProjectActivityPage.tsx";
import { AgentPromptsMenu } from "../prompts/AgentPromptsMenu.tsx";
import { useAgentPromptSubject } from "../prompts/useAgentPromptSubject.ts";
import EpicCreateSheet from "./EpicCreateSheet.tsx";
import EpicStatusControl from "./EpicStatusControl.tsx";
import ProjectEpicAside from "./ProjectEpicAside.tsx";
import ProjectEpicDescription from "./ProjectEpicDescription.tsx";
import ProjectEpicFlow from "./ProjectEpicFlow.tsx";
import ProjectEpicFolios from "./ProjectEpicFolios.tsx";
import ProjectEpicQuests from "./ProjectEpicQuests.tsx";

export interface ProjectEpicProps {
  epic: EpicResource;
}

type TabKey = "overview" | "quests" | "flow" | "folios" | "activity";

/**
 * The Epic detail page (route `projectEpic`, `/epics/:epicNumber`), composed
 * on `@alepha/ui`'s shared `DetailLayout`: an identity aside beside a tabbed
 * right column.
 *
 * It was four zones stacked in one scrolling column until the shell was
 * shared. The four survive as the four tabs, but two of them changed shape
 * in the move: the status BADGE went to the aside while its transition verbs
 * went to the toolbar (`EpicStatusControl` renders only the verbs now), and
 * the dependency flow left the bottom of the Quests card for a tab of its
 * own.
 *
 * `useDetailTab` binds the selection to `?tab=`, so "that epic's flow" is a
 * shareable link, and it writes with `replaceState` so walking the tabs does
 * not bury the page the reader arrived from.
 *
 * Quests and folios are not part of `epicResourceSchema`, so they are two
 * queries keyed on the epic (#E59, rule 7): `["quests", projectId,
 * { epicId }]` and `["folios", projectId, { epicId }]`. Every attach and
 * detach invalidates its key, so the picker, the tables and the aside's
 * derived rows never show stale membership, and a switch to another epic
 * never shows the previous one's rows while the new ones load.
 */
const ProjectEpic = (props: ProjectEpicProps) => {
  const { tr } = useI18n<I18n, "en">();
  const promptSubject = useAgentPromptSubject();
  const dialog = useDialog();
  const epicApi = useClient<EpicController>();
  const questApi = useClient<QuestController>();
  const folioApi = useClient<FolioController>();
  const [project] = useStore(currentProjectAtom);
  const [tab, setTab] = useDetailTab<TabKey>("overview");
  const alepha = useAlepha();
  const queries = useQueryClient();

  const [epic, setEpic] = useState<EpicResource>(props.epic);
  const [editOpen, setEditOpen] = useState(false);

  // The router can hand this page another epic without remounting it (a
  // link from one epic to the next), so the local copy follows the prop when
  // the id changes. During render, so no frame shows the previous epic.
  const [seenEpicId, setSeenEpicId] = useState(props.epic.id);
  if (props.epic.id !== seenEpicId) {
    setSeenEpicId(props.epic.id);
    setEpic(props.epic);
  }

  /**
   * Keep the sidebar's draft-epic badge honest when the status changes
   * here rather than on the list.
   *
   * Marking an epic ready takes it off that badge and sending it back to
   * draft puts it on again, and both happen on this page. `ProjectEpics`
   * recounts from `getEpics` on every fetch, but that only helps once the
   * user navigates back to the list.
   *
   * A delta, not a count: this page knows one epic, never the project total.
   * Read through `store.get` instead of `useStore` so the badge stays
   * write-only here, exactly as it is in the list. The only edges that cross
   * `draft` are the two hand-set ones (#Q2223), so the delta is minus one
   * leaving it, plus one entering it, and nothing otherwise. Kept as a
   * comparison rather than a literal so a response that echoes the same
   * status moves the badge by nothing.
   */
  const applyStatusChange = (updated: EpicResource) => {
    const wasDraft = epic.status === "draft";
    const isDraft = updated.status === "draft";
    if (wasDraft !== isDraft) {
      const current = alepha.store.get(currentEpicCountAtom)?.count ?? 0;
      alepha.store.set(currentEpicCountAtom, {
        count: Math.max(0, current + (isDraft ? 1 : -1)),
      });
    }
    setEpic(updated);
  };

  const questsKey = ["quests", project?.id, { epicId: epic.id }];
  const foliosKey = ["folios", project?.id, { epicId: epic.id }];

  // The epic's own quest set: shelved and draft-gated quests included.
  // `epic: epic.id` on `getQuests` both scopes to this epic AND bypasses
  // the backlog gate (see `QuestController.getQuests`) — the default
  // status filter still excludes shelved quests, so a second call with
  // `status: "shelved"` fills the rest.
  //
  // ⚠️ The answer carries the epic it was read for. `keepPreviousData` keeps
  // the rows on screen while an attach re-reads them, and it would also keep
  // them across a switch to another epic; the id check below is what refuses
  // the second.
  const questsQuery = useQuery(
    {
      key: questsKey,
      enabled: !!project,
      keepPreviousData: true,
      handler: async () => {
        const projectId = project?.id as number;
        const [rest, shelved] = await Promise.all([
          questApi.getQuests({
            params: { projectId },
            query: { epic: epic.id, size: 100 },
          }),
          questApi.getQuests({
            params: { projectId },
            query: { epic: epic.id, status: "shelved", size: 100 },
          }),
        ]);
        return {
          epicId: epic.id,
          items: [...rest.content, ...shelved.content],
        };
      },
    },
    [questApi, project?.id, epic.id],
  );

  // `epicId` filters server-side (`FolioController.list`) rather than
  // fetching the project's folios and filtering client-side: a client-side
  // filter over a `limit`-capped, epic-blind page can drop an attached
  // folio entirely once the project holds more than the page size, with no
  // signal that anything was hidden.
  const foliosQuery = useQuery(
    {
      key: foliosKey,
      enabled: !!project,
      keepPreviousData: true,
      handler: async () => ({
        epicId: epic.id,
        items: await folioApi.list({
          query: {
            projectId: project?.id as number,
            epicId: epic.id,
            limit: 100,
          },
        }),
      }),
    },
    [folioApi, project?.id, epic.id],
  );

  // `null` means "not loaded yet" — either still in flight or the last
  // fetch failed. Only a successfully resolved `[]` means "confirmed
  // empty": the tab bodies must not render an empty state on `null`, or a
  // failed reload reads as an epic with nothing in it.
  const quests: QuestResource[] | null =
    questsQuery.data?.epicId === epic.id ? questsQuery.data.items : null;
  const folios: Folio[] | null =
    foliosQuery.data?.epicId === epic.id ? foliosQuery.data.items : null;

  // One `useAction` per write. A refusal is the server's sentence, toasted by
  // the root `ActionErrorToaster`; the two detach confirmations live in their
  // handlers, so backing out sends nothing.
  const attachQuestAction = useAction<[questId: number], void>(
    {
      handler: async (questId) => {
        setEpic(
          await epicApi.attachQuest({
            params: { id: epic.id },
            body: { questId },
          }),
        );
      },
      invalidates: [questsKey],
    },
    [epicApi, epic.id],
  );

  /**
   * A quest the Quests tab's create sheet just made. `createQuest` has no
   * epic field of its own (`EpicController` owns that mutation), so this is
   * the attach as a second call, the way MCP's `quest_create` files an
   * `epic_number`. And like there, a failed attach deletes the quest rather
   * than leave an unlinked one in the backlog: the reader asked for a quest
   * IN this epic, and a half-done create is worse than none.
   */
  const createdQuestAction = useAction<[quest: QuestResource], void>(
    {
      handler: async (quest) => {
        try {
          setEpic(
            await epicApi.attachQuest({
              params: { id: epic.id },
              body: { questId: quest.id },
            }),
          );
        } catch (error) {
          // The cleanup is best effort: the attach's own refusal is what the
          // reader needs to read, so it is the one rethrown.
          await questApi
            .deleteQuest({ params: { id: quest.id } })
            .catch(() => undefined);
          throw error;
        }
      },
      invalidates: [questsKey],
    },
    [epicApi, questApi, epic.id],
  );

  const detachQuestAction = useAction<[quest: QuestResource], void>(
    {
      handler: async (quest) => {
        const ok = await dialog.confirm({
          title: tr("epic.quests.detach.title"),
          description: tr("epic.quests.detach.confirm", {
            args: [quest.title],
          }),
          confirmLabel: tr("epic.quests.detach"),
          cancelLabel: tr("common.cancel"),
        });
        if (!ok) return;
        setEpic(
          await epicApi.detachQuest({
            params: { id: epic.id, questId: quest.id },
          }),
        );
      },
      invalidates: [questsKey],
    },
    [epicApi, epic.id, dialog, tr],
  );

  const attachFolioAction = useAction<[folioId: string], void>(
    {
      handler: async (folioId) => {
        setEpic(
          await epicApi.attachFolio({
            params: { id: epic.id },
            body: { folioId },
          }),
        );
      },
      invalidates: [foliosKey],
    },
    [epicApi, epic.id],
  );

  const detachFolioAction = useAction<[folio: Folio], void>(
    {
      handler: async (folio) => {
        const ok = await dialog.confirm({
          title: tr("epic.folios.detach.title"),
          description: tr("epic.folios.detach.confirm", {
            args: [folio.title],
          }),
          confirmLabel: tr("epic.folios.detach"),
          cancelLabel: tr("common.cancel"),
        });
        if (!ok) return;
        setEpic(
          await epicApi.detachFolio({
            params: { id: epic.id, folioId: folio.id },
          }),
        );
      },
      invalidates: [foliosKey],
    },
    [epicApi, epic.id, dialog, tr],
  );

  // Page-wide: every membership control waits while any write runs, since
  // `run()` drops a call made while its own is in flight.
  const busy =
    attachQuestAction.loading ||
    createdQuestAction.loading ||
    detachQuestAction.loading ||
    attachFolioAction.loading ||
    detachFolioAction.loading;

  if (!project) {
    return null;
  }

  // A count is shown only once its collection has actually resolved —
  // `null` renders the bare label rather than a confident "0".
  const tabs: DetailTab[] = [
    {
      value: "overview",
      icon: FileText,
      label: tr("epic.tab.overview"),
    },
    {
      value: "quests",
      icon: Swords,
      label: tr("epic.tab.quests"),
      // `count`, not folded into the label: the segmented control colours it
      // from the segment's own state, and a `text-muted-foreground` written
      // here was unreadable on the active tab against the thumb.
      count: quests?.length,
    },
    {
      value: "flow",
      icon: Workflow,
      label: tr("epic.tab.flow"),
    },
    {
      value: "folios",
      icon: BookOpen,
      label: tr("epic.tab.folios"),
      count: folios?.length,
    },
    {
      value: "activity",
      icon: History,
      label: tr("epic.tab.activity"),
    },
  ];

  return (
    <DetailLayout
      aside={
        <ProjectEpicAside epic={epic} quests={quests} onChange={setEpic} />
      }
      tabs={tabs}
      tab={tab}
      onTabChange={(v) => setTab(v as TabKey)}
      actions={
        <>
          {/* The same entries under the same gates as the Epics row menu's
              group, through the same component, so the two surfaces cannot
              come to call the actions different things. `AgentPromptsMenu`
              renders nothing when the option is off or the list is empty,
              which is what a completed epic produces. Review while the plan
              is open, Work on it once the epic is ready: a draft epic's
              quests refuse to be accepted. */}
          <AgentPromptsMenu
            items={[
              ...(epic.status === "draft" || epic.status === "ready"
                ? [
                    {
                      kind: "epicReview" as const,
                      subject: () => promptSubject.forEpic(epic),
                    },
                  ]
                : []),
              ...(epic.status === "ready" || epic.status === "in_progress"
                ? [
                    {
                      kind: "epicActivate" as const,
                      subject: () => promptSubject.forEpic(epic),
                    },
                  ]
                : []),
            ]}
          />
          {/* Only while the plan is still open (#Q2353): a started or
              completed epic's plan is frozen, and the page stops offering to
              edit it. The server still accepts a title or description
              change in every status, which agents rely on to link an
              outcome from a completed epic, so this hides a button and
              refuses nothing. */}
          {epicApi.updateEpic.can() &&
            (epic.status === "draft" || epic.status === "ready") && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-4" />
                {tr("epic.edit")}
              </Button>
            )}
          <EpicStatusControl epic={epic} onChange={applyStatusChange} />
        </>
      }
    >
      {tab === "overview" && <ProjectEpicDescription epic={epic} />}

      {tab === "quests" && (
        <ProjectEpicQuests
          projectId={project.id}
          epic={epic}
          quests={quests}
          busy={busy}
          onAttach={(questId) => void attachQuestAction.run(questId)}
          onDetach={(quest) => void detachQuestAction.run(quest)}
          onCreated={(quest) => createdQuestAction.run(quest)}
        />
      )}

      {tab === "flow" && (
        <ProjectEpicFlow
          quests={quests}
          // Editing a quest from the flow's dialog has to land in the same
          // list the board is drawn from, or the card behind the dialog keeps
          // showing the version it was opened with.
          //
          // Written into the query's cache rather than re-read: the dialog
          // already holds the server's answer.
          onQuestChange={(updated) => {
            const current = questsQuery.data;
            if (current?.epicId !== epic.id) return;
            queries.setData(questsKey, {
              ...current,
              items: current.items.map((q) =>
                q.id === updated.id ? updated : q,
              ),
            });
          }}
        />
      )}

      {tab === "folios" && (
        <ProjectEpicFolios
          projectId={project.id}
          folios={folios}
          busy={busy}
          onAttach={(folioId) => void attachFolioAction.run(folioId)}
          onDetach={(folio) => void detachFolioAction.run(folio)}
        />
      )}

      {tab === "activity" && (
        <ProjectActivityPage
          resource={{ type: "epic", id: String(epic.number) }}
          persistenceKey={`lor.activity.${project.id}.epic.${epic.number}`}
        />
      )}

      {/* Beside the tab bodies, not inside one: a Sheet portals out anyway,
          and nesting it in `children` would unmount it on a tab switch. */}
      <EpicCreateSheet
        projectId={project.id}
        epic={epic}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={(saved) => {
          setEditOpen(false);
          setEpic(saved);
          // The breadcrumb leaf reads the atom, not this component's state,
          // so a rename has to be written back or the header keeps the old
          // title until the next navigation.
          alepha.store.set(currentEpicAtom, saved);
        }}
      />
    </DetailLayout>
  );
};

export default ProjectEpic;
