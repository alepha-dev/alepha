import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui";
import { useInviteOrganizationMember } from "@alepha/ui/organizations";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Mail, Plus, UserPlus } from "lucide-react";
import { useState } from "react";

import { useRank } from "@/web/app/components/shared/useRank.ts";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import {
  type ProjectCreateItem,
  ProjectShellRegistry,
} from "../../registries/ProjectShellRegistry.ts";
import type { I18n } from "../../services/I18n.ts";

const ProjectActionsCreateButton = () => {
  // The registered row whose dialog is open, if any.
  const [openKey, setOpenKey] = useState<string>();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const { can } = useRank();
  const inviteMember = useInviteOrganizationMember();
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const shell = useInject(ProjectShellRegistry);
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  // Each module registers its rows with the capability AND the rank that
  // gate them (#E75, #Q2624): a capability says the project does this at
  // all; a rank says whether THIS reader may. Offering a create the rank
  // refuses is a dialog that can only answer 400 or 403.
  const items = shell.createItems().filter((item) => item.enabled(project));
  const primary = items.filter((item) => item.primary);
  // Everything BELOW the separator. New quest is deliberately not in it: it
  // is what the separator separates from.
  const secondary = items.filter((item) => !item.primary);

  // ⚠️ No button at all rather than an empty dropdown. A project with every
  // capability off is a legal state (the epic's decision 8, and its
  // modularity test), and before this the "+" opened onto one permanently
  // disabled row. The owner keeps it for Invite, which belongs to no
  // capability.
  const canInvite = can("invitation:create");

  if (items.length === 0 && !canInvite) {
    return null;
  }

  const pick = (item: ProjectCreateItem) => {
    if (item.dialog) {
      setOpenKey(item.key);
    } else if (item.route) {
      void router.push(item.route as never, {
        params: { projectSlug: project.slug },
      });
    }
  };

  const row = (item: ProjectCreateItem) => (
    <DropdownMenuItem key={item.key} onClick={() => pick(item)}>
      <item.icon className="size-4" />
      {tr(item.labelKey as never)}
    </DropdownMenuItem>
  );

  const handleInvite = async () => {
    // `undefined` for the rank, spelled out: the header offers no picker, and
    // the argument is required so `useAction`'s context cannot land in it.
    if (
      !(await inviteMember.invite(
        project.organizationId,
        inviteEmail,
        undefined,
      ))
    ) {
      return;
    }
    setInviteEmail("");
    setShowInvite(false);
  };

  const menuLabel = tr("project.menu.create");

  return (
    <>
      {/* One ghost "+" like the header's other icon buttons, and the whole
          create vocabulary behind it, New quest first (feedback #2058).
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
                    variant="minimal"
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
          {primary.map(row)}
          {primary.length > 0 && secondary.length > 0 && (
            <DropdownMenuSeparator />
          )}
          {secondary.map(row)}
          {canInvite && items.length > 0 && <DropdownMenuSeparator />}
          {canInvite && (
            <DropdownMenuItem onClick={() => setShowInvite(true)}>
              <UserPlus className="size-4" />
              {tr("project.menu.invite-member")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {items.map(
        (item) =>
          item.dialog && (
            <item.dialog
              key={item.key}
              project={project}
              open={openKey === item.key}
              onOpenChange={(open) => setOpenKey(open ? item.key : undefined)}
            />
          ),
      )}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("organizations.invitations.inviteTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {tr("project.menu.invite-description", {
                args: [project.title],
              })}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("organizations.invitations.email")}</Label>
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
            <Button variant="outlined" onClick={() => setShowInvite(false)}>
              {tr("organizations.members.cancel")}
            </Button>
            <Button onClick={handleInvite} disabled={inviteMember.loading}>
              {tr("organizations.invitations.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProjectActionsCreateButton;
