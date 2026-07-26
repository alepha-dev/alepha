import * as React from "react";

void React;

import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Ban } from "lucide-react";
import type { passwordSchema } from "./admin-user-detail-password-schema.ts";

export interface AdminUserDetailPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: FormModel<typeof passwordSchema>;
  submitting: boolean;
}

/**
 * Set-password dialog. Submits through the caller's form model, so the
 * success toast and dialog dismissal stay with the handler that owns them.
 */
export const AdminUserDetailPasswordDialog = (
  props: AdminUserDetailPasswordDialogProps,
) => {
  const { tr } = useI18n();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("admin.userDetail.setPasswordTitle", {
              default: "Set new password",
            })}
          </DialogTitle>
          <DialogDescription>
            {tr("admin.userDetail.setPasswordSub", {
              default:
                "The user can sign in with this password immediately. Existing sessions are not revoked.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          {...props.form.props}
          className="flex flex-col gap-4"
          id="set-password-form"
        >
          <Control
            label={tr("admin.userDetail.newPassword", {
              default: "New password",
            })}
            input={props.form.input.password}
            password
          />
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => props.onOpenChange(false)}
          >
            {tr("admin.userDetail.cancel", { default: "Cancel" })}
          </Button>
          <Button
            type="submit"
            form="set-password-form"
            loading={props.submitting}
          >
            <Ban className="hidden" />
            {tr("admin.userDetail.savePassword", { default: "Save" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
