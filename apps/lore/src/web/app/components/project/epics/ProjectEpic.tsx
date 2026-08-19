import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";
import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import ProjectEpicDescription from "./ProjectEpicDescription.tsx";
import ProjectEpicFolios from "./ProjectEpicFolios.tsx";
import ProjectEpicHeader from "./ProjectEpicHeader.tsx";
import ProjectEpicQuests from "./ProjectEpicQuests.tsx";

export interface ProjectEpicProps {
  epic: EpicResource;
}

/**
 * The Epic detail page (route `projectEpic`, `/epics/:epicNumber`). Four
 * zones, one component per file: header (title, status, progress),
 * description, folios, and the full quest set plus the dependency flow.
 *
 * Quests and folios are not part of `epicResourceSchema` — they're fetched
 * separately on mount and kept in local state, refreshed after every
 * attach/detach so the picker and the table never show stale membership.
 */
const ProjectEpic = (props: ProjectEpicProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const epicApi = useClient<EpicController>();
  const questApi = useClient<QuestController>();
  const folioApi = useClient<FolioController>();
  const [project] = useStore(currentProjectAtom);

  const [epic, setEpic] = useState<EpicResource>(props.epic);
  // `null` means "not loaded yet" — either still in flight or the last
  // fetch failed. Only a successfully resolved `[]` means "confirmed
  // empty": the zone components must not render an empty state on `null`,
  // or a failed reload reads as an epic with nothing in it.
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

  return (
    <div className="flex flex-col gap-6 p-4">
      <ProjectEpicHeader epic={epic} onStatusChange={setEpic} />
      <ProjectEpicDescription epic={epic} />
      <ProjectEpicFolios
        projectId={project.id}
        folios={folios}
        onAttach={handleAttachFolio}
        onDetach={handleDetachFolio}
      />
      <ProjectEpicQuests
        projectId={project.id}
        quests={quests}
        onAttach={handleAttachQuest}
        onDetach={handleDetachQuest}
      />
    </div>
  );
};

export default ProjectEpic;
