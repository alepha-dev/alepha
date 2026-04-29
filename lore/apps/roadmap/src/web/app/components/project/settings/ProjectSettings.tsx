import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import type { Character } from "@/api/entities/characters.ts";
import type { InvitationEntity } from "@/api/entities/invitations.ts";
import type { Project } from "@/api/entities/projects.ts";
import type { User } from "@/api/entities/users.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import ProjectUpdate from "../ProjectUpdate.tsx";
import ProjectSettingsCharacterSection from "./ProjectSettingsCharacterSection.tsx";
import ProjectSettingsConfirmationModal from "./ProjectSettingsConfirmationModal.tsx";
import ProjectSettingsPlayersSection from "./ProjectSettingsPlayersSection.tsx";

export interface ProjectSettingsProps {
  project: Project;
  players: Array<Character & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
}

const ProjectSettings = (props: ProjectSettingsProps) => {
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const projectApi = useClient<ProjectController>();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  if (!project) {
    return null;
  }

  const handleDelete = async () => {
    await projectApi.deleteProjectById({ params: { id: project.id } });
    alepha.store.set(
      userProjectsAtom,
      (alepha.store.get(userProjectsAtom) ?? []).filter(
        (p) => p.id !== project.id,
      ),
    );
    setDeleteModalOpen(false);
    router.push("home");
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <div className="flex flex-col gap-6">
        {/* General */}
        <div className="flex flex-col gap-2">
          <span className="text-sm">
            {tr("project.settings.general.title")}
          </span>
          <ProjectUpdate project={project} />
        </div>

        {/* Character */}
        <ProjectSettingsCharacterSection />

        {/* Players */}
        <ProjectSettingsPlayersSection
          project={project}
          players={props.players}
          pendingInvitations={props.pendingInvitations}
        />

        {/* Danger Zone */}
        <div className="flex flex-col gap-2">
          <span className="text-sm">{tr("project.settings.danger.title")}</span>
          <Card className="bg-card shadow">
            <CardContent className="grid grid-cols-1 gap-4 p-4 xs:grid-cols-2">
              <div className="flex flex-col gap-0">
                <span className="text-sm">
                  {tr("project.settings.actions.delete")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("project.settings.actions.delete.helper")}
                </span>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  variant="destructive"
                  onClick={() => setDeleteModalOpen(true)}
                >
                  {tr("project.settings.actions.delete")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <ProjectSettingsConfirmationModal
          open={deleteModalOpen}
          project={project}
          onCancel={() => setDeleteModalOpen(false)}
          onConfirm={handleDelete}
        />
      </div>
    </div>
  );
};

export default ProjectSettings;
