import { ControlPassword } from "@alepha/ui/components/control-password/control-password";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type {
  MyIdentityController,
  MyPasswordController,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { type FormEvent, useState } from "react";

export interface AccountPasswordDialogProps {
  open: boolean;

  /**
   * Whether the account already has a `credentials` identity. Decides both
   * the copy and — critically — which endpoint is called.
   */
  hasPassword: boolean;

  onOpenChange: (open: boolean) => void;

  /**
   * Called after a successful change so the caller can refresh its identity
   * list — setting a first password creates one.
   */
  onDone?: () => void | Promise<void>;
}

/**
 * Set a first password, or change an existing one.
 *
 * ⚠️ **These are two different endpoints and must stay so.**
 * `setMyFirstPassword` takes only the new password and trusts the session,
 * which is defensible when there is nothing to prove knowledge of. Reusing it
 * to *change* a password would make any unattended signed-in browser a full
 * account takeover.
 *
 * `changeMyPassword` verifies the current password and revokes every other
 * session — the usual reason to change a password is believing someone else
 * has it, and leaving their session alive would accomplish nothing. It
 * reports how many it ended, which is why the toast can say so rather than
 * leave the person wondering about their phone.
 */
export const AccountPasswordDialog = (props: AccountPasswordDialogProps) => {
  const passwordApi = useClient<MyPasswordController>();
  const identityApi = useClient<MyIdentityController>();
  const toaster = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
    props.onOpenChange(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toaster.show("The two passwords do not match", "danger");
      return;
    }
    setSubmitting(true);
    try {
      if (props.hasPassword) {
        const { otherSessionsRevoked } = await passwordApi.changeMyPassword({
          body: { currentPassword, newPassword: password },
        });
        toaster.show(
          otherSessionsRevoked > 0
            ? `Password changed — ${otherSessionsRevoked} other session(s) signed out`
            : "Password changed",
          "success",
        );
      } else {
        await identityApi.setMyFirstPassword({ body: { password } });
        toaster.show("Password set", "success");
      }
      await props.onDone?.();
      close();
    } catch (error: any) {
      // The realm's password policy and the wrong-current-password refusal
      // both arrive here with messages worth showing verbatim.
      toaster.show(error?.message ?? "Could not save that password", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  const title = props.hasPassword ? "Change password" : "Set a password";

  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <span className="text-muted-foreground text-sm">
            {props.hasPassword
              ? "Every other device will be signed out."
              : "You will be able to sign in with your password as well as your existing method."}
          </span>
          {props.hasPassword ? (
            <ControlPassword
              id="currentPassword"
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              required
            />
          ) : null}
          <ControlPassword
            id="newPassword"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
          />
          <ControlPassword
            id="confirmPassword"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {title}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
