import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useAlepha, useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Check, Mail, X } from "lucide-react";
import { useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";
import { Toaster } from "../../services/Toaster.ts";

export interface MyInvitationsProps {
  invitations: Array<{
    id: string;
    resourceId: string;
    resourceName: string;
    invitedBy: string;
    inviterName?: string;
    inviterEmail?: string;
    status: "pending" | "accepted" | "declined" | "expired" | "revoked";
    createdAt: string;
  }>;
}

const MyInvitations = (props: MyInvitationsProps) => {
  const [invitations, setInvitations] = useState(props.invitations);
  const invitationApi = useClient<InvitationController>();
  const campaignApi = useClient<CampaignController>();
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {},
  );
  const alepha = useAlepha();
  const toaster = useInject(Toaster);
  const { l } = useI18n();

  const handleAccept = async (invitationId: string) => {
    setLoadingStates((prev) => ({ ...prev, [invitationId]: true }));
    try {
      await invitationApi.acceptInvitation({ params: { id: invitationId } });
      setInvitations(await invitationApi.getMyInvitations());
      alepha.store.set(userCampaignsAtom, await campaignApi.getHomeOverview());
      toaster.show(
        "You have joined the campaign! A character has been created for you.",
        "success",
      );
    } catch (error: any) {
      toaster.show(error?.message || "Failed to accept invitation", "danger");
    } finally {
      setLoadingStates((prev) => ({ ...prev, [invitationId]: false }));
    }
  };

  const handleDecline = async (invitationId: string) => {
    setLoadingStates((prev) => ({ ...prev, [invitationId]: true }));
    try {
      await invitationApi.declineInvitation({ params: { id: invitationId } });
      setInvitations(await invitationApi.getMyInvitations());
      toaster.show("The invitation has been declined.", "warning");
    } catch (error: any) {
      toaster.show(error?.message || "Failed to decline invitation", "danger");
    } finally {
      setLoadingStates((prev) => ({ ...prev, [invitationId]: false }));
    }
  };

  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending",
  );
  const processedInvitations = invitations.filter(
    (inv) => inv.status !== "pending",
  );

  if (!invitations || invitations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8">
        <Mail className="size-10 opacity-30" />
        <span className="text-center text-muted-foreground">
          No invitations yet.
        </span>
        <span className="text-center text-sm text-muted-foreground">
          When someone invites you to their campaign, it will appear here.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="flex items-center gap-2">
        <Mail className="size-5" />
        <span className="text-lg font-bold">Invitations</span>
        {pendingInvitations.length > 0 && (
          <Badge variant="default">{pendingInvitations.length} pending</Badge>
        )}
      </div>

      {/* Pending */}
      {pendingInvitations.length > 0 && (
        <div className="flex flex-col gap-3">
          {pendingInvitations.map((invitation) => {
            const busy = Object.values(loadingStates).some(Boolean);
            return (
              <div
                key={invitation.id}
                className="flex flex-col gap-2 rounded-md border border-border border-l-4 border-l-orange-500 bg-card p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {invitation.resourceName}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        Pending
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      From {invitation.inviterName || invitation.inviterEmail}{" "}
                      &middot; {l(invitation.createdAt)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleAccept(invitation.id)}
                      disabled={busy}
                    >
                      <Check className="size-3.5" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDecline(invitation.id)}
                      disabled={busy}
                    >
                      <X className="size-3.5" />
                      Decline
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Previous */}
      {processedInvitations.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Previous
          </span>
          {processedInvitations.map((invitation) => (
            <div
              key={invitation.id}
              className={`flex items-center gap-3 rounded-md border border-border border-l-4 bg-card p-3 opacity-70 ${
                invitation.status === "accepted"
                  ? "border-l-green-500"
                  : "border-l-red-500"
              }`}
            >
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium">
                  {invitation.resourceName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {invitation.inviterName || invitation.inviterEmail} &middot;{" "}
                  {l(invitation.createdAt)}
                </span>
              </div>
              <Badge
                variant={
                  invitation.status === "accepted" ? "secondary" : "destructive"
                }
                className="text-xs"
              >
                {invitation.status.charAt(0).toUpperCase() +
                  invitation.status.slice(1)}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyInvitations;
