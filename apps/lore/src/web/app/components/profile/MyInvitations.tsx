import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { Check, Mail, X } from "lucide-react";
import { useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";

type Inbox = Awaited<ReturnType<InvitationController["listMyInvitations"]>>;

export interface MyInvitationsProps {
  invitations: Inbox;
}

const MyInvitations = (props: MyInvitationsProps) => {
  const invitationApi = useClient<InvitationController>();
  const campaignApi = useClient<CampaignController>();
  const router = useRouter<AppRouter>();
  const alepha = useAlepha();
  const toaster = useToast();

  const [items, setItems] = useState<Inbox>(props.invitations);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);

  const accept = async (id: string, campaignId: string) => {
    setBusyId(id);
    try {
      await invitationApi.acceptInvitation({ params: { id } });
      alepha.store.set(userCampaignsAtom, await campaignApi.getHomeOverview());
      setItems((prev) => prev.filter((it) => it.id !== id));
      toaster.success("You have joined the campaign!");
      await router.push("campaign", { params: { campaignId } });
    } catch (error: any) {
      toaster.error(error?.message ?? "Failed to accept invitation");
    } finally {
      setBusyId(undefined);
    }
  };

  const decline = async (id: string) => {
    setBusyId(id);
    try {
      await invitationApi.declineInvitation({ params: { id } });
      setItems((prev) => prev.filter((it) => it.id !== id));
      toaster.show("Invitation declined.", "warning");
    } catch (error: any) {
      toaster.error(error?.message ?? "Failed to decline invitation");
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2 p-2">
      <div className="p-2">
        <span className="text-xs text-muted-foreground">
          Pending campaign invitations addressed to your email. Accept to join
          the campaign as a new character, or decline to drop the invite.
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-card p-6 text-center">
          <Mail className="size-5 text-muted-foreground" />
          <span className="text-sm">No pending invitations.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
          {items.map((invitation) => (
            <div
              key={invitation.id}
              className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3 shadow-sm"
            >
              <div className="bg-background flex size-10 items-center justify-center rounded-md">
                <Mail className="size-5" />
              </div>
              <div className="flex flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {invitation.campaignTitle}
                  </span>
                  <Badge variant="secondary">Pending</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {invitation.inviterName
                    ? `Invited by ${invitation.inviterName}`
                    : "Invited"}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => decline(invitation.id)}
                  disabled={busyId === invitation.id}
                >
                  <X className="size-3.5" /> Decline
                </Button>
                <Button
                  size="sm"
                  onClick={() => accept(invitation.id, invitation.resourceId)}
                  disabled={busyId === invitation.id}
                >
                  <Check className="size-3.5" /> Accept
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
