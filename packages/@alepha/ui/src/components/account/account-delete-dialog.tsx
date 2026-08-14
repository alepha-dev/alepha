import { ControlPassword } from "@alepha/ui/components/control-password/control-password";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type {
  MyAccountController,
  MyProfileController,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

export interface AccountDeleteDialogProps {
  open: boolean;

  /**
   * Whether the account has a `credentials` identity. An OAuth-only account
   * has no password to prove knowledge of, so the field is not shown — and
   * the server agrees, accepting the confirmation phrase alone.
   */
  hasPassword: boolean;

  onOpenChange: (open: boolean) => void;

  /**
   * Application-supplied consequences, rendered above the confirmation field.
   *
   * The framework can say what deleting an *account* does; it cannot say what
   * that costs inside your data. An application whose foreign keys cascade —
   * rows the account authored inside other people's projects, say — puts the
   * count here so the person reads it *before* confirming rather than
   * discovering it afterwards.
   *
   * A `ReactNode` rather than a string because the honest version of this is
   * usually a live count, which means a component that fetches one.
   */
  warning?: ReactNode;

  /**
   * Called once the account is gone. The caller signs the (now orphaned)
   * session out.
   */
  onDeleted: () => void | Promise<void>;
}

/**
 * Permanently delete your own account.
 *
 * Asks for two independent things because the two failure modes are different
 * people: the password proves it is *you* (against someone at your unlocked
 * laptop), and typing the confirmation phrase proves you *meant it* (against
 * you, five seconds from now).
 *
 * The phrase is fetched rather than guessed. The server accepts the account's
 * email, falling back to username and then the literal `DELETE`, and this
 * dialog must ask for exactly what the server will accept — a hardcoded
 * "type DELETE" would be refused for every account that has an email.
 */
export const AccountDeleteDialog = (props: AccountDeleteDialogProps) => {
  const accountApi = useClient<MyAccountController>();
  const profileApi = useClient<MyProfileController>();
  const toaster = useToast();

  const [expected, setExpected] = useState<string | undefined>();
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    let cancelled = false;
    profileApi
      .getMyProfile()
      .then((profile) => {
        if (!cancelled) {
          setExpected(profile.email ?? profile.username ?? "DELETE");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExpected("DELETE");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, profileApi]);

  const close = () => {
    setConfirm("");
    setCurrentPassword("");
    props.onOpenChange(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await accountApi.deleteMyAccount({
        body: {
          confirm,
          currentPassword: props.hasPassword ? currentPassword : undefined,
        },
      });
      await props.onDeleted();
    } catch (error: any) {
      /*
        An application's `user:delete:before` hook refuses here — "You still
        own 3 projects" — and the framework's fast-path emit delivers that
        message unwrapped. Showing it verbatim is the entire reason the emit
        avoids `{ log: true }`; a generic "could not delete" would waste it.
      */
      toaster.show(error?.message ?? "Could not delete your account", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  const ready = expected !== undefined && confirm === expected;

  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <span className="text-muted-foreground text-sm">
            This permanently removes your account, its sign-in methods and every
            session. It cannot be undone.
          </span>

          {props.warning}

          {props.hasPassword ? (
            <ControlPassword
              id="deleteCurrentPassword"
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              required
            />
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deleteConfirm">
              Type <span className="font-mono">{expected ?? "…"}</span> to
              confirm
            </Label>
            <Input
              id="deleteConfirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={submitting || !ready}
            >
              Delete account
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
