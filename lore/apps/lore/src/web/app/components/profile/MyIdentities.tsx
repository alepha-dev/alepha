import { Badge } from "@alepha/ui/components/ui/badge";
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
import { AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { GitBranch, Key, Lock, Shield, User } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { IdentityController } from "@/api/controllers/IdentityController.ts";

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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const identityApi = useClient<IdentityController>();
  const toaster = useToast();
  const dt = useInject(DateTimeProvider);
  const { l } = useI18n();

  const hasPasswordIdentity = localIdentities.some(
    (identity) => identity.provider === "credentials",
  );

  const close = () => {
    setOpened(false);
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toaster.show("Passwords do not match", "danger");
      return;
    }
    setSubmitting(true);
    try {
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
      toaster.show("Password has been set successfully", "success");
      close();
    } catch (error: any) {
      toaster.show(error?.message || "Failed to set password", "danger");
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
    if (provider === "credentials") return "Password";
    return provider;
  };

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="size-5" />
          <span className="text-lg font-bold">Identities</span>
          <Badge variant="secondary">{localIdentities.length}</Badge>
        </div>
        {!hasPasswordIdentity && (
          <Button variant="secondary" size="sm" onClick={() => setOpened(true)}>
            <Lock className="size-3.5" />
            Set Password
          </Button>
        )}
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
                  Active
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
              No identities found. This shouldn't happen.
            </span>
          </div>
        )}
      </div>

      <Dialog open={opened} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Password</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <span className="text-sm text-muted-foreground">
              Set up a password to sign in with your email address without going
              through an external provider.
            </span>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                Set Password
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyIdentities;
