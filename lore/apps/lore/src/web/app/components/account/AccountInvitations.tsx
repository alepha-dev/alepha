import { AccountPage } from "@alepha/ui/account";
import { MyOrganizationInvitations } from "@alepha/ui/organizations";
import { useAlepha, useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useCallback } from "react";

import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";

const AccountInvitations = () => {
  const invitationApi = useClient<InvitationController>();
  const projectApi = useClient<ProjectController>();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();

  const load = useCallback(async () => {
    const invitations = await invitationApi.listMyInvitations();
    return invitations.map((invitation) => ({
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: invitation.projectTitle,
      email: invitation.email,
      rank: invitation.rank,
      inviterName: invitation.inviterName,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    }));
  }, [invitationApi]);
  const accept = useCallback(
    async (invitationId: string) => {
      const result = await invitationApi.acceptInvitation({
        params: { id: invitationId },
      });
      const overview = await projectApi.getHomeOverview();
      alepha.store.set(userProjectsAtom, overview);
      return result.projectId;
    },
    [alepha, invitationApi, projectApi],
  );
  const decline = useCallback(
    async (invitationId: string) => {
      await invitationApi.declineInvitation({ params: { id: invitationId } });
    },
    [invitationApi],
  );
  const onAccepted = useCallback(
    async (projectId: string) => {
      const overview = alepha.store.get(userProjectsAtom);
      const joined = overview?.projects.find(
        (project) => String(project.id) === projectId,
      );
      if (joined) {
        await router.push("project", {
          params: { projectSlug: joined.slug },
        });
      }
    },
    [alepha, router],
  );

  return (
    <AccountPage variant="table">
      <MyOrganizationInvitations
        className="min-h-0 flex-1"
        load={load}
        accept={accept}
        decline={decline}
        onAccepted={onAccepted}
      />
    </AccountPage>
  );
};

export default AccountInvitations;
