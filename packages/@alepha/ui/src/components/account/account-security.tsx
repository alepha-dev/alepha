import { AccountDeleteDialog } from "@alepha/ui/components/account/account-delete-dialog";
import { AccountMfaDialog } from "@alepha/ui/components/account/account-mfa-dialog";
import { AccountPasswordDialog } from "@alepha/ui/components/account/account-password-dialog";
import { SettingsDangerSection } from "@alepha/ui/components/settings/settings-danger-section";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type {
  MyIdentity,
  MyIdentityController,
  MyMfaController,
  MyMfaStatus,
  RealmConfig,
} from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { KeyRound, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import { PROVIDER_LABELS } from "../auth/provider-labels.ts";

export interface AccountSecurityProps {
  identities?: MyIdentity[];

  /**
   * Carries `settings.mfa`, which decides whether the two-factor row is
   * offered at all.
   *
   * Optional for the same reason it is on Profile. Absent, the row renders:
   * the historical behaviour, and the safer guess, since hiding a factor a realm
   * does want is a worse failure than showing one it does not, because the
   * server refuses the enrollment either way.
   */
  realmConfig?: RealmConfig;

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
  const mfaApi = useClient<MyMfaController>();
  const auth = useAuth();
  const dialog = useDialog();
  const toaster = useToast();
  const { l, tr } = useI18n();

  const [identities, setIdentities] = useState<MyIdentity[]>(
    props.identities ?? [],
  );
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);

  const { data: mfa, refetch: reloadMfa } = useQuery<MyMfaStatus>(
    { handler: () => mfaApi.getMyMfa() as Promise<MyMfaStatus> },
    [],
  );

  const hasPassword = identities.some((it) => it.provider === "credentials");

  /**
   * A TOTP enrollment is stored as an identity row, but it is not a way to
   * sign in. Listing it here would both duplicate the two-factor row below
   * and offer a Remove button that strips the factor without asking for a
   * code, which is exactly what `disableTotp` refuses to do.
   */
  const signInMethods = identities.filter((it) => it.provider !== "totp");

  /**
   * A realm can turn the authenticator-app factor off. Offering a Set up
   * button then walks the user through a QR, ten recovery codes and an "On"
   * badge for a factor the login gate will never ask for, so the row is not
   * offered at all.
   *
   * An enrollment that predates the setting is the exception: it stays
   * visible, because hiding it would strand a factor the user can neither see
   * nor remove.
   */
  const totpDisabled = props.realmConfig?.settings?.mfa?.totp === "disabled";
  const totpStranded = totpDisabled && !!mfa?.totp.enabled;
  const showMfaRow = !totpDisabled || totpStranded;

  const reload = async () => setIdentities(await api.listMyIdentities());

  /**
   * Turning it off asks for a current code rather than just a confirmation.
   * A session alone is not proof: someone at an unattended signed-in browser
   * could otherwise strip the factor and come back later at leisure.
   */
  const disableMfa = async () => {
    const code = await dialog.prompt({
      title: tr("account.security.mfaDisableTitle", {
        default: "Turn off two-factor authentication?",
      }),
      description: tr("account.security.mfaDisableDescription", {
        default:
          "Enter a code from your authenticator app, or one of your recovery codes.",
      }),
      confirmLabel: tr("account.security.mfaTurnOff", { default: "Turn off" }),
    });
    if (!code) {
      return;
    }
    try {
      await mfaApi.disableTotp({ body: { code: String(code) } });
      await reloadMfa();
      toaster.show(
        tr("account.security.mfaDisabled", {
          default: "Two-factor authentication is off",
        }),
        "success",
      );
    } catch (error: any) {
      toaster.show(
        error?.message ??
          tr("account.security.invalidCode", {
            default: "That code is not valid",
          }),
        "danger",
      );
    }
  };

  const unlink = async (identity: MyIdentity) => {
    const label = PROVIDER_LABELS[identity.provider] ?? identity.provider;
    const ok = await dialog.confirm({
      title: tr("account.security.unlinkTitle", {
        default: "Remove $1?",
        args: [label],
      }),
      description: tr("account.security.unlinkDescription", {
        default: "You will no longer be able to sign in with $1.",
        args: [label],
      }),
      confirmLabel: tr("account.security.unlink", { default: "Remove" }),
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
      toaster.show(
        error?.message ??
          tr("account.security.unlinkError", {
            default: "Could not remove that method",
          }),
        "danger",
      );
    }
  };

  return (
    <>
      <SettingsSection
        title={tr("account.security.methodsTitle", {
          default: "Sign-in methods",
        })}
        description={tr("account.security.methodsDescription", {
          default:
            "At least one must remain. Removing the last would lock you out permanently.",
        })}
      >
        {signInMethods.map((identity) => (
          <SettingsRow
            key={identity.id}
            label={PROVIDER_LABELS[identity.provider] ?? identity.provider}
            description={tr("account.security.addedAt", {
              default: "Added $1",
              args: [String(l(identity.createdAt, { date: "ll" }))],
            })}
          >
            {signInMethods.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => unlink(identity)}
                aria-label={tr("account.security.unlinkAria", {
                  default: "Remove $1",
                  args: [identity.provider],
                })}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </SettingsRow>
        ))}

        {showMfaRow ? (
          <SettingsRow
            label={tr("account.security.mfa", {
              default: "Two-factor authentication",
            })}
            description={
              totpStranded
                ? tr("account.security.mfaNoLongerUsed", {
                    default:
                      "This site no longer asks for a code. You can remove it.",
                  })
                : mfa?.totp.enabled
                  ? // Two calls, not one with a computed key: the FR coverage spec
                    // finds keys by matching a literal right after `tr(`, so a key
                    // chosen at runtime is invisible to it and would rot silently.
                    mfa.totp.recoveryCodesLeft === 1
                    ? tr("account.security.mfaOnOneCode", {
                        default: "On. $1 recovery code left.",
                        args: [String(mfa.totp.recoveryCodesLeft)],
                      })
                    : tr("account.security.mfaOnCodes", {
                        default: "On. $1 recovery codes left.",
                        args: [String(mfa.totp.recoveryCodesLeft)],
                      })
                  : tr("account.security.mfaOff", {
                      default:
                        "Ask for a code from an authenticator app as well as your password.",
                    })
            }
          >
            {mfa?.totp.enabled ? (
              <Button variant="secondary" size="sm" onClick={disableMfa}>
                <ShieldOff className="size-4" />
                {tr("account.security.mfaTurnOff", { default: "Turn off" })}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMfaOpen(true)}
              >
                <ShieldCheck className="size-4" />
                {tr("account.security.mfaSetUp", { default: "Set up" })}
              </Button>
            )}
          </SettingsRow>
        ) : null}

        <SettingsRow
          label={tr("account.security.password", { default: "Password" })}
          description={
            hasPassword
              ? tr("account.security.passwordChangeHint", {
                  default: "Changing it signs out every other device.",
                })
              : tr("account.security.passwordSetHint", {
                  default:
                    "This account signs in without a password. Add one as a fallback.",
                })
          }
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPasswordOpen(true)}
          >
            <KeyRound className="size-4" />
            {hasPassword
              ? tr("account.security.passwordChange", {
                  default: "Change password",
                })
              : tr("account.security.passwordSet", {
                  default: "Set a password",
                })}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsDangerSection
        description={tr("account.security.dangerDescription", {
          default: "This cannot be undone.",
        })}
      >
        <SettingsRow
          label={tr("account.security.delete", {
            default: "Delete this account",
          })}
          description={tr("account.security.deleteDescription", {
            default:
              "Removes your account, its sign-in methods and every session.",
          })}
        >
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
          >
            {tr("account.security.deleteButton", {
              default: "Delete account",
            })}
          </Button>
        </SettingsRow>
      </SettingsDangerSection>

      <AccountPasswordDialog
        open={passwordOpen}
        hasPassword={hasPassword}
        onOpenChange={setPasswordOpen}
        onDone={reload}
      />

      <AccountMfaDialog
        open={mfaOpen}
        onOpenChange={setMfaOpen}
        onDone={async () => {
          await reloadMfa();
        }}
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
