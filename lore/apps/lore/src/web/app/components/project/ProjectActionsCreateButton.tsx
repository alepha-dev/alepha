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
  DropdownMenuSeparator,
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
import { useClient, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import {
  BookOpen,
  ChevronDown,
  Layers,
  Mail,
  MessageSquarePlus,
  Plus,
  UserPlus,
} from "lucide-react";
import { useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { kanbanReloadAtom } from "../../atoms/kanbanReloadAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { useInviteMember } from "../shared/useInviteMember.ts";
import EpicCreateSheet from "./epics/EpicCreateSheet.tsx";
import QuestCreate from "./quest/QuestCreate.tsx";

const ProjectActionsCreateButton = () => {
  const [showDialog, setShowDialog] = useState(false);
  const [showEpic, setShowEpic] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const inviteMember = useInviteMember();
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const auth = useAuth();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [reloadKey, setReloadKey] = useStore(kanbanReloadAtom);
  const routerState = useRouterState();
  // Kanban is its own route again, so this is just the route name. It used
  // to be `projectQuests` plus the stored view, because the board was a mode
  // of the Quests page rather than a place.
  const onKanban = routerState.name === "projectKanban";

  if (!project) {
    return null;
  }

  const canCreateQuest = client.createQuest.can();
  const features = project.features;
  const folioEnabled = features.folios;
  const feedbackEnabled = features.feedback;
  const epicsEnabled = features.epics;
  const isOwner = project.createdBy === auth.user?.id;
  const hasCreateAction = epicsEnabled || folioEnabled || feedbackEnabled;
  const hasSecondaryAction = hasCreateAction || isOwner;

  const handleInvite = async () => {
    if (!(await inviteMember.invite(project.id, inviteEmail))) return;
    setInviteEmail("");
    setShowInvite(false);
  };

  const mainLabel = tr("project.menu.create-quest");

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
          className={`${mainClass} md:w-auto md:gap-1.5 md:px-4`}
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
                  aria-label={tr("project.menu.create-more")}
                  className={`${baseClass} rounded-l-none border-l border-white/20 px-2`}
                />
              }
            >
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {epicsEnabled && (
                <DropdownMenuItem onClick={() => setShowEpic(true)}>
                  <Layers className="size-4" />
                  {tr("project.menu.create-epic")}
                </DropdownMenuItem>
              )}
              {folioEnabled && (
                <DropdownMenuItem
                  onClick={() =>
                    router.push("projectFoliosNew", {
                      params: { projectSlug: project.slug },
                    })
                  }
                >
                  <BookOpen className="size-4" />
                  {tr("project.menu.create-folio")}
                </DropdownMenuItem>
              )}
              {feedbackEnabled && (
                <DropdownMenuItem
                  onClick={() =>
                    router.push("projectFeedbackRequest", {
                      params: { projectSlug: project.slug },
                    })
                  }
                >
                  <MessageSquarePlus className="size-4" />
                  {tr("project.menu.create-feedback")}
                </DropdownMenuItem>
              )}
              {isOwner && hasCreateAction && <DropdownMenuSeparator />}
              {isOwner && (
                <DropdownMenuItem onClick={() => setShowInvite(true)}>
                  <UserPlus className="size-4" />
                  {tr("project.menu.invite-member")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Sheet open={showDialog} onOpenChange={setShowDialog}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{mainLabel}</SheetTitle>
          </SheetHeader>
          <QuestCreate
            project={project}
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
      <EpicCreateSheet
        projectId={project.id}
        open={showEpic}
        onOpenChange={setShowEpic}
        onSubmit={(epic) => {
          setShowEpic(false);
          void router.push("projectEpic", {
            params: {
              projectSlug: project.slug,
              epicNumber: String(epic.number),
            },
          });
        }}
      />
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("project.settings.members.invite.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {tr("project.settings.members.invite.description", {
                args: [project.title],
              })}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("project.settings.members.invite.email")}</Label>
              <div className="relative">
                <Mail className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                <Input
                  className="pl-8"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleInvite();
                  }}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>
              {tr("project.settings.members.invite.cancel")}
            </Button>
            <Button onClick={handleInvite} disabled={inviteMember.loading}>
              {tr("project.settings.members.invite.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProjectActionsCreateButton;
