import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { cn } from "@alepha/ui/lib/utils";
import { useAuth } from "alepha/react/auth";
import { Localize, useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Mail, Plus, Users } from "lucide-react";
import { useState } from "react";

import type { InvitationEntity } from "@/api/entities/invitations.ts";
import type { Member } from "@/api/entities/members.ts";
import type { Project } from "@/api/entities/projects.ts";
import type { User } from "@/api/entities/users.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { MemberIdentity } from "@/web/app/components/shared/MemberIdentity.tsx";
import { useInviteMember } from "@/web/app/components/shared/useInviteMember.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsMembersSectionProps {
  project: Project;
  members: Array<Member & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
}

const ProjectSettingsMembersSection = (
  props: ProjectSettingsMembersSectionProps,
) => {
  const router = useRouter<AppRouter>();
  const inviteMember = useInviteMember();
  const auth = useAuth();
  const { tr } = useI18n<I18n, "en">();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");

  const members = props.members;
  const pendingInvitations = props.pendingInvitations ?? [];

  const handleInvite = async () => {
    if (!(await inviteMember.invite(props.project.id, email))) return;
    setEmail("");
    setOpen(false);
    // Re-run the loader for the new pending row; a hard reload threw the
    // whole app state away for one list.
    await router.push(router.pathname, { force: true });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("project.settings.members.invite.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {tr("project.settings.members.invite.description", {
                args: [props.project.title],
              })}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("project.settings.members.invite.email")}</Label>
              <div className="relative">
                <Mail className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                <Input
                  className="pl-8"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleInvite();
                  }}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tr("project.settings.members.invite.cancel")}
            </Button>
            <Button onClick={handleInvite} disabled={inviteMember.loading}>
              {tr("project.settings.members.invite.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {tr("project.settings.members.title")}
            </span>
            <Badge variant="secondary">
              {members.length + pendingInvitations.length}
            </Badge>
          </div>
          {props.project.createdBy === auth.user?.id && (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-3.5" />
              {tr("project.settings.members.invite.action")}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {members.map((member) => (
            <Card key={member.id} className={cn(settingsCardEdge, "py-3")}>
              <CardContent className="flex items-center gap-4 px-3">
                <div className="flex flex-1 items-center gap-3">
                  <MemberIdentity member={member} variant="card" />
                  <span className="text-muted-foreground text-xs">
                    {member.user.email}
                  </span>
                </div>

                <span className="text-muted-foreground text-xs">
                  <Localize value={member.createdAt} date="fromNow" />
                </span>
              </CardContent>
            </Card>
          ))}

          {pendingInvitations.map((invitation) => (
            <Card
              key={invitation.id}
              className={cn(settingsCardEdge, "py-3 opacity-80")}
            >
              <CardContent className="flex items-center gap-4 px-3">
                <div className="bg-muted flex size-10 items-center justify-center rounded-md">
                  <Mail className="size-5" />
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {invitation.email}
                    </span>
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    <Localize value={invitation.createdAt} date="fromNow" />
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}

          {members.length === 0 && pendingInvitations.length === 0 && (
            <Card className={settingsCardEdge}>
              <CardContent className="flex flex-col items-center justify-center gap-2">
                <Users className="size-8 opacity-50" />
                <span className="text-muted-foreground text-center text-sm">
                  {tr("project.settings.members.empty")}
                </span>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectSettingsMembersSection;
