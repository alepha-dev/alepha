import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  cn,
  useDialog,
} from "@alepha/ui";
import { settingsCardEdge } from "@alepha/ui/settings";
import type { MemberController } from "alepha/api/organizations";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { ProjectController } from "../../../../../api/controllers/ProjectController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../../atoms/userProjectsAtom.ts";
import { setCurrentProject } from "../../../services/currentProjectWrite.ts";
import type { I18n } from "../../../services/I18n.ts";
import { mergeIntoProjectOverview } from "../../../services/projectOverviewWrite.ts";
import { useRank } from "../../shared/useRank.ts";
import ProjectSettingsConfirmationModal from "./ProjectSettingsConfirmationModal.tsx";

const ProjectSettingsDangerZoneSection = () => {
  const { can } = useRank();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const projectApi = useClient<ProjectController>();
  const memberApi = useClient<MemberController>();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const dialog = useDialog();

  // A refused delete or leave (an owned project, a server error) leaves the
  // dialog open, and the root `ActionErrorToaster` says why. The overview
  // refresh and the navigation are inside the handler, so neither runs after
  // a refusal.
  const deleteAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        await projectApi.deleteProjectById({ params: { id: project.id } });
        alepha.store.set(userProjectsAtom, await projectApi.getHomeOverview());
        setDeleteModalOpen(false);
        await router.push("home");
      },
    },
    [projectApi, alepha, router, project],
  );

  // Archive and Unarchive (#Q2601): one action, the direction read off the
  // project. The row it answers goes into both atoms, so the switcher and
  // Home drop (or regain) the project without a refetch.
  const archiveAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        const archiving = !project.archivedAt;
        const args = { args: [project.title] };
        const confirmed = await dialog.confirm(
          archiving
            ? {
                title: tr("project.settings.archive.confirm.title", args),
                description: tr("project.settings.archive.confirm.description"),
                confirmLabel: tr("project.settings.archive.confirm.submit"),
              }
            : {
                title: tr("project.settings.unarchive.confirm.title", args),
                description: tr(
                  "project.settings.unarchive.confirm.description",
                ),
                confirmLabel: tr("project.settings.unarchive.confirm.submit"),
              },
        );
        if (!confirmed) return;
        const params = { params: { id: project.id } };
        const updated = archiving
          ? await projectApi.archiveProject(params)
          : await projectApi.unarchiveProject(params);
        setCurrentProject(alepha, updated);
        mergeIntoProjectOverview(alepha, updated);
      },
    },
    [projectApi, alepha, dialog, tr, project],
  );

  const leaveAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        await memberApi.leaveOrganization({
          params: { organizationId: project.organizationId },
        });
        alepha.store.set(userProjectsAtom, await projectApi.getHomeOverview());
        setLeaveDialogOpen(false);
        await router.push("home");
      },
    },
    [projectApi, memberApi, alepha, router, project],
  );

  if (!project) {
    return null;
  }

  const isOwner = can("project:delete");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm">{tr("project.settings.danger.title")}</span>
        <Card className={cn(settingsCardEdge, "divide-y py-0")}>
          {isOwner ? (
            <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {project.archivedAt
                    ? tr("project.settings.actions.unarchive")
                    : tr("project.settings.actions.archive")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {project.archivedAt
                    ? tr("project.settings.actions.unarchive.helper")
                    : tr("project.settings.actions.archive.helper")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Button
                  variant="outlined"
                  data-testid="project-archive-toggle"
                  disabled={archiveAction.loading}
                  onClick={() => void archiveAction.run()}
                >
                  {project.archivedAt
                    ? tr("project.settings.actions.unarchive")
                    : tr("project.settings.actions.archive")}
                </Button>
              </div>
            </CardContent>
          ) : null}
          {isOwner ? (
            <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("project.settings.actions.delete")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("project.settings.actions.delete.helper")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Button
                  variant="outlined"
                  intent="danger"
                  onClick={() => setDeleteModalOpen(true)}
                >
                  {tr("project.settings.actions.delete")}
                </Button>
              </div>
            </CardContent>
          ) : (
            <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("project.settings.actions.leave")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("project.settings.actions.leave.helper")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Button
                  variant="outlined"
                  intent="danger"
                  onClick={() => setLeaveDialogOpen(true)}
                >
                  {tr("project.settings.actions.leave")}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      <ProjectSettingsConfirmationModal
        open={deleteModalOpen}
        project={project}
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={() => void deleteAction.run()}
      />

      <AlertDialog
        open={leaveDialogOpen}
        onOpenChange={(o) => !o && setLeaveDialogOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("project.settings.leave.modal.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr("project.settings.leave.modal.description", {
                args: [project.title],
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLeaveDialogOpen(false)}>
              {tr("project.settings.leave.modal.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={leaveAction.loading}
              onClick={() => void leaveAction.run()}
              intent="danger"
            >
              {tr("project.settings.leave.modal.submit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProjectSettingsDangerZoneSection;
