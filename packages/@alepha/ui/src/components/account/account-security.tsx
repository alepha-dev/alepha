import { AccountDeleteDialog } from "@alepha/ui/components/account/account-delete-dialog";
import { AccountPasswordDialog } from "@alepha/ui/components/account/account-password-dialog";
import { SettingsDangerSection } from "@alepha/ui/components/settings/settings-danger-section";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { MyIdentity, MyIdentityController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { KeyRound, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { PROVIDER_LABELS } from "../auth/provider-labels.ts";

export interface AccountSecurityProps {
  identities?: MyIdentity[];

  /**
   * Rendered inside the delete-account dialog, above the confirmation field.
   * See {@link AccountDeleteDialogProps.warning} — this is how an application
   * states what deletion costs in *its* data.
   */
  deleteWarning?: ReactNode;
}

/**
 * How you get in, and how to stop existing.
 *
 * The delete-account row lives here rather than on Profile because the
 * re-authentication it demands is the same material as everything else on
 * this page — and because a destructive action on the page you land on by
 * default is a worse default than one behind a deliberate click.
 */
const AccountSecurity = (props: AccountSecurityProps) => {
  const api = useClient<MyIdentityController>();
  const auth = useAuth();
  const dialog = useDialog();
  const toaster = useToast();
  const { l } = useI18n();

  const [identities, setIdentities] = useState<MyIdentity[]>(
    props.identities ?? [],
  );
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const hasPassword = identities.some((it) => it.provider === "credentials");

  const reload = async () => setIdentities(await api.listMyIdentities());

  const unlink = async (identity: MyIdentity) => {
    const label = PROVIDER_LABELS[identity.provider] ?? identity.provider;
    const ok = await dialog.confirm({
      title: `Remove ${label}?`,
      description: `You will no longer be able to sign in with ${label}.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) {
      return;
    }
    try {
      await api.unlinkMyIdentity({ params: { id: identity.id } });
      await reload();
    } catch (error: any) {
      // Includes the last-identity refusal, whose message is the whole point.
      toaster.show(error?.message ?? "Could not remove that method", "danger");
    }
  };

  return (
    <>
      <SettingsSection
        title="Sign-in methods"
        description="At least one must remain. Removing the last would lock you out permanently."
      >
        {identities.map((identity) => (
          <SettingsRow
            key={identity.id}
            label={PROVIDER_LABELS[identity.provider] ?? identity.provider}
            description={`Added ${String(l(identity.createdAt, { date: "ll" }))}`}
          >
            {identities.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => unlink(identity)}
                aria-label={`Remove ${identity.provider}`}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </SettingsRow>
        ))}

        <SettingsRow
          label="Password"
          description={
            hasPassword
              ? "Changing it signs out every other device."
              : "This account signs in without a password. Add one as a fallback."
          }
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPasswordOpen(true)}
          >
            <KeyRound className="size-4" />
            {hasPassword ? "Change password" : "Set a password"}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsDangerSection description="This cannot be undone.">
        <SettingsRow
          label="Delete this account"
          description="Removes your account, its sign-in methods and every session."
        >
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
          >
            Delete account
          </Button>
        </SettingsRow>
      </SettingsDangerSection>

      <AccountPasswordDialog
        open={passwordOpen}
        hasPassword={hasPassword}
        onOpenChange={setPasswordOpen}
        onDone={reload}
      />

      <AccountDeleteDialog
        open={deleteOpen}
        hasPassword={hasPassword}
        onOpenChange={setDeleteOpen}
        warning={props.deleteWarning}
        onDeleted={() => auth.logout()}
      />
    </>
  );
};

export default AccountSecurity;
