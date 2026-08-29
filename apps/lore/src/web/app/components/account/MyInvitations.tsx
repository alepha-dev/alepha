import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Check, Mail, X } from "lucide-react";
import { useState } from "react";

import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

type Inbox = Awaited<ReturnType<InvitationController["listMyInvitations"]>>;

export interface MyInvitationsProps {
  invitations: Inbox;
}

const MyInvitations = (props: MyInvitationsProps) => {
  const invitationApi = useClient<InvitationController>();
  const projectApi = useClient<ProjectController>();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const toaster = useToast();
  const { tr } = useI18n<I18n, "en">();

  const [items, setItems] = useState<Inbox>(props.invitations);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);

  const accept = async (id: string, projectId: string) => {
    setBusyId(id);
    try {
      await invitationApi.acceptInvitation({ params: { id } });
      const overview = await projectApi.getHomeOverview();
      alepha.store.set(userProjectsAtom, overview);
      setItems((prev) => prev.filter((it) => it.id !== id));
      toaster.success(tr("invitations.accepted"));
      // The invitation carries the project's id, but the URL takes its slug.
      // The overview was just refreshed and now includes the project we joined,
      // so read it from there rather than adding a lookup endpoint.
      const joined = overview.projects.find(
        (it) => String(it.id) === projectId,
      );
      if (joined) {
        await router.push("project", { params: { projectSlug: joined.slug } });
      }
    } catch (error: any) {
      toaster.error(error?.message ?? String(tr("invitations.accept.error")));
    } finally {
      setBusyId(undefined);
    }
  };

  const decline = async (id: string) => {
    setBusyId(id);
    try {
      await invitationApi.declineInvitation({ params: { id } });
      setItems((prev) => prev.filter((it) => it.id !== id));
      toaster.show(String(tr("invitations.declined")), "warning");
    } catch (error: any) {
      toaster.error(error?.message ?? String(tr("invitations.decline.error")));
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      {/*
        This page had a description and no title at all, so the rail led to a
        page that never named itself. `SettingsHeading` is what the rest of the
        `/account` area titles itself with.

        The old copy also said "join the project as a new character", which the
        2026-07 de-gamification pass removed everywhere else: `characters`
        became `members` and identity moved to the account.
      */}
      <SettingsHeading
        title={String(tr("invitations.title"))}
        description={String(tr("invitations.description"))}
      />

      {items.length === 0 ? (
        <div className="border-border bg-card flex flex-col items-center gap-2 rounded-md border p-6 text-center">
          <Mail className="text-muted-foreground size-5" />
          <span className="text-sm">{tr("invitations.empty")}</span>
        </div>
      ) : (
        <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-2">
          {items.map((invitation) => (
            <div
              key={invitation.id}
              className="border-border bg-muted/40 flex items-center gap-3 rounded-md border p-3 shadow-sm"
            >
              <div className="bg-background flex size-10 items-center justify-center rounded-md">
                <Mail className="size-5" />
              </div>
              <div className="flex flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {invitation.projectTitle}
                  </span>
                  <Badge variant="secondary">
                    {tr("invitations.badge.pending")}
                  </Badge>
                </div>
                <span className="text-muted-foreground text-xs">
                  {invitation.inviterName
                    ? tr("invitations.invitedBy", {
                        args: [invitation.inviterName],
                      })
                    : tr("invitations.invited")}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => decline(invitation.id)}
                  disabled={busyId === invitation.id}
                >
                  <X className="size-3.5" /> {tr("invitations.decline")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => accept(invitation.id, invitation.resourceId)}
                  disabled={busyId === invitation.id}
                >
                  <Check className="size-3.5" /> {tr("invitations.accept")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyInvitations;
