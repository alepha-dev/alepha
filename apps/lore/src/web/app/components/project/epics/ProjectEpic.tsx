import {
  DetailLayout,
  type DetailTab,
} from "@alepha/ui/components/detail/detail-layout";
import { useDetailTab } from "@alepha/ui/components/detail/use-detail-tab";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BookOpen, FileText, Pencil, Swords, Workflow } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
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

type TabKey = "overview" | "quests" | "flow" | "folios";

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
 * Quests and folios are not part of `epicResourceSchema` — they're fetched
 * separately on mount and kept in local state, refreshed after every
 * attach/detach so the picker, the tables and the aside's derived rows never
 * show stale membership.
 */
const ProjectEpic = (props: ProjectEpicProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const epicApi = useClient<EpicController>();
  const questApi = useClient<QuestController>();
  const folioApi = useClient<FolioController>();
  const [project] = useStore(currentProjectAtom);
  const [tab, setTab] = useDetailTab<TabKey>("overview");
  const alepha = useAlepha();

  const [epic, setEpic] = useState<EpicResource>(props.epic);
  const [editOpen, setEditOpen] = useState(false);

  /**
   * Keep the sidebar's planned-epic badge honest when the status changes
   * here rather than on the list.
   *
   * Releasing an epic is the main way that badge goes DOWN, and it happens
   * on this page. `ProjectEpics` recounts from `getEpics` on every fetch,
   * but that only helps once the user navigates back to the list.
   *
   * A delta, not a count: this page knows one epic, never the project total.
   * Read through `store.get` instead of `useStore` so the badge stays
   * write-only here, exactly as it is in the list.
   */
  const applyStatusChange = (updated: EpicResource) => {
    const wasPlanned = epic.status === "planned";
    const isPlanned = updated.status === "planned";
    if (wasPlanned !== isPlanned) {
      const current = alepha.store.get(currentEpicCountAtom)?.count ?? 0;
      alepha.store.set(currentEpicCountAtom, {
        count: Math.max(0, current + (isPlanned ? 1 : -1)),
      });
    }
    setEpic(updated);
  };
  // `null` means "not loaded yet" — either still in flight or the last
  // fetch failed. Only a successfully resolved `[]` means "confirmed
  // empty": the tab bodies must not render an empty state on `null`, or a
  // failed reload reads as an epic with nothing in it.
  const [quests, setQuests] = useState<QuestResource[] | null>(null);
  const [folios, setFolios] = useState<Folio[] | null>(null);

  // The epic's own quest set: shelved and planned-gated quests included.
  // `epic: epic.id` on `getQuests` both scopes to this epic AND bypasses
  // the backlog gate (see `QuestController.getQuests`) — the default
  // status filter still excludes shelved quests, so a second call with
  // `status: "shelved"` fills the rest.
  const reloadQuests = useCallback(async () => {
    if (!project?.id) return;
    try {
      const [rest, shelved] = await Promise.all([
        questApi.getQuests({
          params: { projectId: project.id },
          query: { epic: epic.id, size: 100 },
        }),
        questApi.getQuests({
          params: { projectId: project.id },
          query: { epic: epic.id, status: "shelved", size: 100 },
        }),
      ]);
      setQuests([...rest.content, ...shelved.content]);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  }, [project?.id, epic.id, questApi, toaster]);

  // `epicId` filters server-side (`FolioController.list`) rather than
  // fetching the project's folios and filtering client-side: a client-side
  // filter over a `limit`-capped, epic-blind page can drop an attached
  // folio entirely once the project holds more than the page size, with no
  // signal that anything was hidden.
  const reloadFolios = useCallback(async () => {
    if (!project?.id) return;
    try {
      const all = await folioApi.list({
        query: { projectId: project.id, epicId: epic.id, limit: 100 },
      });
      setFolios(all);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  }, [project?.id, epic.id, folioApi, toaster]);

  useEffect(() => {
    void reloadQuests();
  }, [reloadQuests]);
  useEffect(() => {
    void reloadFolios();
  }, [reloadFolios]);

  if (!project) {
    return null;
  }

  const handleAttachQuest = async (questId: number) => {
    try {
      const updated = await epicApi.attachQuest({
        params: { id: epic.id },
        body: { questId },
      });
      setEpic(updated);
      await reloadQuests();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDetachQuest = async (quest: QuestResource) => {
    const ok = await dialog.confirm({
      title: tr("epic.quests.detach.title"),
      description: tr("epic.quests.detach.confirm", { args: [quest.title] }),
      confirmLabel: tr("epic.quests.detach"),
      cancelLabel: tr("common.cancel"),
    });
    if (!ok) return;
    try {
      const updated = await epicApi.detachQuest({
        params: { id: epic.id, questId: quest.id },
      });
      setEpic(updated);
      await reloadQuests();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAttachFolio = async (folioId: string) => {
    try {
      const updated = await epicApi.attachFolio({
        params: { id: epic.id },
        body: { folioId },
      });
      setEpic(updated);
      await reloadFolios();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDetachFolio = async (folio: Folio) => {
    const ok = await dialog.confirm({
      title: tr("epic.folios.detach.title"),
      description: tr("epic.folios.detach.confirm", { args: [folio.title] }),
      confirmLabel: tr("epic.folios.detach"),
      cancelLabel: tr("common.cancel"),
    });
    if (!ok) return;
    try {
      const updated = await epicApi.detachFolio({
        params: { id: epic.id, folioId: folio.id },
      });
      setEpic(updated);
      await reloadFolios();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  // A count is shown only once its collection has actually resolved —
  // `null` renders the bare label rather than a confident "0".
  const withCount = (label: ReactNode, count: number | undefined): ReactNode =>
    count === undefined ? (
      label
    ) : (
      <>
        {label}
        <span className="text-muted-foreground ml-1 tabular-nums">{count}</span>
      </>
    );

  const tabs: DetailTab[] = [
    {
      value: "overview",
      icon: FileText,
      label: tr("epic.tab.overview"),
    },
    {
      value: "quests",
      icon: Swords,
      label: withCount(tr("epic.tab.quests"), quests?.length),
    },
    {
      value: "flow",
      icon: Workflow,
      label: tr("epic.tab.flow"),
    },
    {
      value: "folios",
      icon: BookOpen,
      label: withCount(tr("epic.tab.folios"), folios?.length),
    },
  ];

  return (
    <DetailLayout
      aside={<ProjectEpicAside epic={epic} quests={quests} />}
      tabs={tabs}
      tab={tab}
      onTabChange={(v) => setTab(v as TabKey)}
      actions={
        <>
          <Button variant="outline" size="lg" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" />
            {tr("epic.edit")}
          </Button>
          <EpicStatusControl epic={epic} onChange={applyStatusChange} />
        </>
      }
    >
      {tab === "overview" && <ProjectEpicDescription epic={epic} />}

      {tab === "quests" && (
        <ProjectEpicQuests
          projectId={project.id}
          quests={quests}
          onAttach={handleAttachQuest}
          onDetach={handleDetachQuest}
        />
      )}

      {tab === "flow" && (
        <ProjectEpicFlow
          quests={quests}
          // Editing a quest from the flow's dialog has to land in the same
          // list the board is drawn from, or the card behind the dialog keeps
          // showing the version it was opened with.
          onQuestChange={(updated) =>
            setQuests((prev) =>
              prev
                ? prev.map((q) => (q.id === updated.id ? updated : q))
                : prev,
            )
          }
        />
      )}

      {tab === "folios" && (
        <ProjectEpicFolios
          projectId={project.id}
          folios={folios}
          onAttach={handleAttachFolio}
          onDetach={handleDetachFolio}
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
