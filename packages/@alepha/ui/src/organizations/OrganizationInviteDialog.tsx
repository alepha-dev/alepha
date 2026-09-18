import { z } from "alepha";
import type { OrganizationRankResource } from "alepha/api/organizations";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Mail } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { Input } from "../core/Input.tsx";
import { Label } from "../core/Label.tsx";
import { Control } from "../form/Control.tsx";
import { useInviteOrganizationMember } from "./useInviteOrganizationMember.ts";

const inviteRankFieldSchema = z.object({ rank: z.text() });

export interface OrganizationInviteDialogProps {
  organizationId: string;
  ranks: OrganizationRankResource[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

export const OrganizationInviteDialog = (
  props: OrganizationInviteDialogProps,
) => {
  const { tr } = useI18n();
  const invite = useInviteOrganizationMember();
  const [email, setEmail] = useState("");
  const form = useForm({
    schema: inviteRankFieldSchema,
    initialValues: { rank: "member" },
    handler: () => {},
  });
  const rank = String(useFormValues(form).rank ?? "member");

  const submit = async () => {
    props.onBusyChange?.(true);
    try {
      const invited = await invite.invite(props.organizationId, email, rank);
      if (!invited) return;
      setEmail("");
      form.input.rank.set("member");
      props.onOpenChange(false);
      await props.onInvited();
    } finally {
      props.onBusyChange?.(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("organizations.invitations.inviteTitle", {
              default: "Invite a member",
            })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="organization-invite-email">
              {tr("organizations.invitations.email", { default: "Email" })}
            </Label>
            <div className="relative">
              <Mail className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
              <Input
                id="organization-invite-email"
                className="pl-8"
                value={email}
                placeholder="user@example.com"
                onChange={(event) => setEmail(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
            </div>
          </div>
          <Control
            select
            input={form.input.rank}
            label={tr("organizations.members.rank", { default: "Rank" })}
            items={props.ranks
              .filter((item) => item.key !== "owner")
              .map((item) => ({ value: item.key, label: item.name }))}
            inputProps={{ "data-testid": "invite-rank" }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            {tr("organizations.members.cancel", { default: "Cancel" })}
          </Button>
          <Button onClick={() => void submit()} disabled={invite.loading}>
            {tr("organizations.invitations.send", {
              default: "Send invitation",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
