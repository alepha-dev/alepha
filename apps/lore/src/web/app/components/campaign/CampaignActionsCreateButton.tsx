import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import {
  BookOpen,
  ChevronDown,
  Mail,
  MessageSquarePlus,
  Plus,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { kanbanReloadAtom } from "../../atoms/kanbanCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import QuestCreate from "./quest/QuestCreate.tsx";

const CampaignActionsCreateButton = () => {
  const [showDialog, setShowDialog] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const invitationApi = useClient<InvitationController>();
  const auth = useAuth();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const [reloadKey, setReloadKey] = useStore(kanbanReloadAtom);
  const routerState = useRouterState();
  const onKanban = routerState.name === "campaignKanban";

  if (!campaign) {
    return null;
  }

  const canCreateQuest = client.createQuest.can();
  const features = campaign.features;
  const folioEnabled = features.folios;
  const petitionEnabled = features.petitions;
  const isOwner = campaign.createdBy === auth.user?.id;
  const hasSecondaryAction = folioEnabled || petitionEnabled || isOwner;

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toaster.error("Please enter an email address");
      return;
    }
    setInviteLoading(true);
    try {
      await invitationApi.createInvitation({
        body: {
          email: inviteEmail.trim(),
          resourceType: "campaign",
          resourceId: String(campaign.id),
        },
      });
      toaster.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setShowInvite(false);
    } catch (error: any) {
      toaster.error(error.message || "Failed to send invitation");
    } finally {
      setInviteLoading(false);
    }
  };

  const mainLabel = tr("campaign.menu.create-quest");

  // Green base for both halves; the caret half drops a touch of opacity so
  // the eye reads them as one button with a divider.
  const baseClass = "bg-green-600 text-white hover:bg-green-700";
  const mainClass = hasSecondaryAction
    ? `${baseClass} rounded-r-none`
    : baseClass;

  return (
    <>
      <div className="flex items-stretch">
        <Button
          size="icon"
          disabled={!canCreateQuest}
          onClick={() => setShowDialog(true)}
          aria-label={mainLabel}
          className={`${mainClass} md:w-auto md:px-4`}
        >
          <Plus className="size-4" />
          <span className="hidden md:inline">{mainLabel}</span>
        </Button>
        {hasSecondaryAction && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  disabled={!canCreateQuest}
                  aria-label={tr("campaign.menu.create-more")}
                  className={`${baseClass} rounded-l-none border-l border-white/20 px-2`}
                />
              }
            >
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {folioEnabled && (
                <DropdownMenuItem
                  onClick={() =>
                    router.push("campaignFoliosNew", {
                      params: { campaignId: String(campaign.id) },
                    })
                  }
                >
                  <BookOpen className="size-4" />
                  {tr("campaign.menu.create-folio")}
                </DropdownMenuItem>
              )}
              {petitionEnabled && (
                <DropdownMenuItem
                  onClick={() =>
                    router.push("campaignPetitionRequest", {
                      params: { campaignId: String(campaign.id) },
                    })
                  }
                >
                  <MessageSquarePlus className="size-4" />
                  {tr("campaign.menu.create-petition")}
                </DropdownMenuItem>
              )}
              {isOwner && (
                <DropdownMenuItem onClick={() => setShowInvite(true)}>
                  <UserPlus className="size-4" />
                  {tr("campaign.menu.create-character")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{mainLabel}</SheetTitle>
          </SheetHeader>
          <QuestCreate
            campaign={campaign}
            onSubmit={() => setShowDialog(false)}
            onCreated={
              onKanban
                ? () => {
                    setShowDialog(false);
                    setReloadKey({ key: (reloadKey?.key ?? 0) + 1 });
                  }
                : undefined
            }
          />
        </SheetContent>
      </Sheet>
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("campaign.settings.characters.invite.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {tr("campaign.settings.characters.invite.description", {
                args: [campaign.title],
              })}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("campaign.settings.characters.invite.email")}</Label>
              <div className="relative">
                <Mail className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                <Input
                  className="pl-8"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleInvite();
                  }}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>
              {tr("campaign.settings.characters.invite.cancel")}
            </Button>
            <Button onClick={handleInvite} disabled={inviteLoading}>
              {tr("campaign.settings.characters.invite.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CampaignActionsCreateButton;
