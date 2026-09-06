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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useClient, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import {
  AppWindow,
  BookOpen,
  Flag,
  Layers,
  Mail,
  MessageSquarePlus,
  Plus,
  ScrollText,
  UserPlus,
} from "lucide-react";
import { useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { kanbanReloadAtom } from "../../atoms/kanbanReloadAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import {
  capabilityOption,
  hasCapability,
} from "../../services/projectCapabilities.ts";
import { useInviteMember } from "../shared/useInviteMember.ts";
import AppCreateDialog from "./apps/AppCreateDialog.tsx";
import EpicCreateSheet from "./epics/EpicCreateSheet.tsx";
import QuestCreate from "./quest/QuestCreate.tsx";
import ReleaseCreateDialog from "./releases/ReleaseCreateDialog.tsx";

const ProjectActionsCreateButton = () => {
  const [showDialog, setShowDialog] = useState(false);
  const [showEpic, setShowEpic] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [showApp, setShowApp] = useState(false);
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
  // Each item names the capability that owns it, and the option inside it
  // where there is one. `releases` is the key `features.milestones` should
  // always have had: it could not be renamed inside a JSON column whose
  // required keys take production down when one goes missing, and moving the
  // storage is what let the name move with it.
  //
  // ⚠️ New Quest was the one item gated on the PERMISSION alone. It reads as
  // an oversight rather than a decision because every other item here already
  // named its capability, and it left a Knowledge-only project offering the
  // one create that answers 400 - the first thing a reader would try.
  const questEnabled = hasCapability(project, "work");
  const folioEnabled = hasCapability(project, "knowledge");
  const feedbackEnabled = hasCapability(project, "support");
  const epicsEnabled = capabilityOption(project, "work", "epics");
  const releasesEnabled = capabilityOption(project, "work", "releases");
  const isOwner = project.createdBy === auth.user?.id;
  // ⚠️ Gated on ownership as well as on the capability. Creating an instance
  // is owner-only server-side, so a member shown this item would open a dialog
  // that can only answer 403 - the one create in this menu with that property.
  // The ownership half stays until Ranks replaces it with `can()`.
  const appsEnabled = hasCapability(project, "apps") && isOwner;
  // Everything BELOW the separator. Quest is deliberately not in it: it is
  // what the separator separates from.
  const hasCreateAction =
    epicsEnabled ||
    releasesEnabled ||
    appsEnabled ||
    folioEnabled ||
    feedbackEnabled;

  // ⚠️ No button at all rather than an empty dropdown. A project with every
  // capability off is a legal state (the epic's decision 8, and its modularity
  // test), and before this the "+" opened onto one permanently disabled row.
  // The owner keeps it for Invite, which belongs to no capability.
  if (!questEnabled && !hasCreateAction && !isOwner) {
    return null;
  }

  const handleInvite = async () => {
    if (!(await inviteMember.invite(project.id, inviteEmail))) return;
    setInviteEmail("");
    setShowInvite(false);
  };

  const mainLabel = tr("project.menu.create-quest");
  const menuLabel = String(tr("project.menu.create"));

  return (
    <>
      {/* One ghost "+" like the header's other icon buttons, and the whole
          create vocabulary behind it, New Quest first (feedback #2058).
          It replaced a green split button whose main half was Create Quest:
          the lists carry their own labelled create action now (quest
          #1682), so the header no longer has to shout. Icon-only, so it
          keeps an aria-label and a tooltip; the #1317 rule only drops
          tooltips that repeat a visible label. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={menuLabel}
                    data-testid="project-create-menu"
                  />
                }
              >
                <Plus className="size-4" />
              </DropdownMenuTrigger>
            }
          />
          <TooltipContent>{menuLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-44">
          {questEnabled && (
            <DropdownMenuItem
              disabled={!canCreateQuest}
              onClick={() => setShowDialog(true)}
            >
              <ScrollText className="size-4" />
              {mainLabel}
            </DropdownMenuItem>
          )}
          {questEnabled && hasCreateAction && <DropdownMenuSeparator />}
          {epicsEnabled && (
            <DropdownMenuItem onClick={() => setShowEpic(true)}>
              <Layers className="size-4" />
              {tr("project.menu.create-epic")}
            </DropdownMenuItem>
          )}
          {/* Directly after New Epic, matching the sidebar's Epics then
              Releases: a release is when the epic ships. */}
          {releasesEnabled && (
            <DropdownMenuItem onClick={() => setShowRelease(true)}>
              <Flag className="size-4" />
              {tr("project.menu.create-release")}
            </DropdownMenuItem>
          )}
          {/* After New Release, matching the sidebar's Work then Ops order:
              an app is where the work is deployed, not part of planning it. */}
          {appsEnabled && (
            <DropdownMenuItem onClick={() => setShowApp(true)}>
              <AppWindow className="size-4" />
              {tr("project.menu.create-app")}
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
          {isOwner && <DropdownMenuSeparator />}
          {isOwner && (
            <DropdownMenuItem onClick={() => setShowInvite(true)}>
              <UserPlus className="size-4" />
              {tr("project.menu.invite-member")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
      {/* #1635's surface, reused rather than a second one built here. */}
      <ReleaseCreateDialog
        projectId={project.id}
        open={showRelease}
        onOpenChange={setShowRelease}
        onCreated={(created) => {
          setShowRelease(false);
          // Onto the release itself, the way New Epic opens the epic it just
          // made. A release is addressed by its TAG, and the row is
          // unreachable without one, so a tagless answer falls back to the
          // list rather than routing to a broken URL.
          void (created.tag
            ? router.push("projectRelease", {
                params: {
                  projectSlug: project.slug,
                  releaseTag: created.tag,
                },
              })
            : router.push("projectReleases", {
                params: { projectSlug: project.slug },
              }));
        }}
      />
      {/* The one create dialog, mounted here and from the Apps list. It
          navigates to what it made, the way New Epic and New Release do:
          creating from the header and landing back where you started is the
          shape that makes people click twice. */}
      <AppCreateDialog
        open={showApp}
        onOpenChange={setShowApp}
        onCreated={(instance) => {
          void router.push("app", {
            params: {
              projectSlug: project.slug,
              app: instance.app,
              env: instance.env,
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
