import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alepha/ui/components/ui/alert-dialog";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ProjectSettingsConfirmationModal from "./ProjectSettingsConfirmationModal.tsx";

const ProjectSettingsDangerZoneSection = () => {
  const alepha = useAlepha();
  const auth = useAuth();
  const { tr } = useI18n<I18n, "en">();
  const projectApi = useClient<ProjectController>();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  if (!project) {
    return null;
  }

  const isOwner = project.createdBy === auth.user?.id;

  const handleDelete = async () => {
    await projectApi.deleteProjectById({ params: { id: project.id } });
    alepha.store.set(userProjectsAtom, await projectApi.getHomeOverview());
    setDeleteModalOpen(false);
    void router.push("home");
  };

  const handleLeave = async () => {
    await projectApi.leaveProject({ params: { id: project.id } });
    alepha.store.set(userProjectsAtom, await projectApi.getHomeOverview());
    setLeaveDialogOpen(false);
    void router.push("home");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm">{tr("project.settings.danger.title")}</span>
        <Card className="bg-card divide-y rounded-lg border py-0">
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
                  variant="destructive"
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
                  variant="destructive"
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
        onConfirm={handleDelete}
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
              onClick={handleLeave}
              className="bg-destructive hover:bg-destructive/90 text-white"
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
