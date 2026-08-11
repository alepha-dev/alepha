import { ControlPassword } from "@alepha/ui/components/control-password/control-password";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { AlephaError } from "alepha";
import type { MyPasswordController } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { GitBranch, Key, Lock, Shield, User } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { IdentityController } from "@/api/controllers/IdentityController.ts";
import type { I18n } from "../../services/I18n.ts";

export interface MyIdentitiesProps {
  identities: Array<{
    id: string;
    provider: string;
    providerUserId: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

const MyIdentities = (props: MyIdentitiesProps) => {
  const { identities } = props;
  const [opened, setOpened] = useState(false);
  const [localIdentities, setLocalIdentities] = useState(identities);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const identityApi = useClient<IdentityController>();
  const passwordApi = useClient<MyPasswordController>();
  const toaster = useToast();
  const dt = useInject(DateTimeProvider);
  const { l, tr } = useI18n<I18n, "en">();

  const hasPasswordIdentity = localIdentities.some(
    (identity) => identity.provider === "credentials",
  );

  const close = () => {
    setOpened(false);
    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
  };

  /**
   * Changing an existing password goes through a DIFFERENT endpoint than
   * setting a first one, and deliberately so.
   *
   * `identityApi.setPassword` takes only the new password and trusts the
   * session — defensible when there is no password yet, since there is nothing
   * to prove knowledge of. Reusing it to *change* one would make an unattended
   * signed-in browser a full account takeover.
   *
   * `changeMyPassword` is the framework's self-service path and already makes
   * both calls this needs: it verifies `currentPassword`, and it revokes every
   * OTHER session while keeping this one — the usual reason to change a
   * password is believing someone else has it, and leaving their session alive
   * would accomplish nothing. It reports how many it ended, which is why the
   * toast can say so rather than leave the person guessing about their phone.
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toaster.show(
        String(tr("profile.identities.password.mismatch")),
        "danger",
      );
      return;
    }
    setSubmitting(true);
    try {
      if (hasPasswordIdentity) {
        const { otherSessionsRevoked } = await passwordApi.changeMyPassword({
          body: { currentPassword, newPassword: password },
        });
        toaster.show(
          String(
            tr("profile.identities.password.changed", {
              args: [String(otherSessionsRevoked)],
            }),
          ),
          "success",
        );
        close();
        return;
      }

      const { success } = await identityApi.setPassword({
        body: { password },
      });
      if (!success) {
        throw new AlephaError("Server rejected the password change");
      }
      const nowIso = dt.nowISOString();
      setLocalIdentities((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          provider: "credentials",
          providerUserId: "",
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ]);
      toaster.show(String(tr("profile.identities.password.wasSet")), "success");
      close();
    } catch (error: any) {
      toaster.show(
        error?.message || String(tr("profile.identities.password.failed")),
        "danger",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const providerIcon = (provider: string) => {
    if (provider === "github") return <GitBranch className="size-4" />;
    if (provider === "credentials") return <Key className="size-4" />;
    return <User className="size-4" />;
  };

  const providerLabel = (provider: string) => {
    if (provider === "github") return "GitHub";
    if (provider === "google") return "Google";
    if (provider === "credentials")
      return String(tr("profile.identities.provider.credentials"));
    return provider;
  };

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="size-5" />
          <span className="text-lg font-bold">
            {tr("profile.identities.title")}
          </span>
          <Badge variant="secondary">{localIdentities.length}</Badge>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpened(true)}>
          <Lock className="size-3.5" />
          {tr(
            hasPasswordIdentity
              ? "profile.identities.password.change"
              : "profile.identities.password.set",
          )}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {localIdentities.map((identity) => (
          <div
            key={identity.id}
            className="flex items-center gap-4 rounded-md border border-border bg-card p-4"
          >
            <div className="flex size-9 items-center justify-center rounded-md bg-muted">
              {providerIcon(identity.provider)}
            </div>
            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">
                  {providerLabel(identity.provider)}
                </span>
                <Badge variant="outline" className="text-xs">
                  {tr("profile.identities.active")}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {identity.provider === "credentials"
                  ? identity.providerUserId
                  : `ID: ${identity.providerUserId}`}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {l(identity.createdAt)}
            </span>
          </div>
        ))}

        {localIdentities.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <User className="size-10 opacity-30" />
            <span className="text-center text-muted-foreground">
              {tr("profile.identities.empty")}
            </span>
          </div>
        )}
      </div>

      <Dialog open={opened} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr(
                hasPasswordIdentity
                  ? "profile.identities.password.change"
                  : "profile.identities.password.set",
              )}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <span className="text-sm text-muted-foreground">
              {tr(
                hasPasswordIdentity
                  ? "profile.identities.password.changeHint"
                  : "profile.identities.password.setHint",
              )}
            </span>
            {hasPasswordIdentity && (
              <ControlPassword
                id="currentPassword"
                label={String(tr("profile.identities.password.current"))}
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
                required
              />
            )}
            <ControlPassword
              id="password"
              label={String(tr("profile.identities.password.new"))}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              required
            />
            <ControlPassword
              id="confirmPassword"
              label={String(tr("profile.identities.password.confirm"))}
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              required
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                {tr("profile.identities.password.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {tr(
                  hasPasswordIdentity
                    ? "profile.identities.password.change"
                    : "profile.identities.password.set",
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyIdentities;
