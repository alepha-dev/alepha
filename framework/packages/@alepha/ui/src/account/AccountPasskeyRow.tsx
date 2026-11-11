import type { MyPasskey, MyPasskeyController } from "alepha/api/users";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Fingerprint, Pencil, Trash2 } from "lucide-react";

import { ACCOUNT_PASSKEYS_KEY } from "../auth/usePasskey.ts";
import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { SettingsRow } from "../settings/SettingsRow.tsx";

export interface AccountPasskeyRowProps {
  passkey: MyPasskey;

  /**
   * When it was added and last used, already worded.
   */
  lastUsed: string;

  onRemove: () => void;
}

/**
 * One passkey: its name, when it was added and last used, whether it is
 * synced, and its rename and remove buttons. Renaming asks for no proof: a
 * name changes nothing about who can sign in.
 */
export const AccountPasskeyRow = (props: AccountPasskeyRowProps) => {
  const api = useClient<MyPasskeyController>();
  const dialog = useDialog();
  const { tr } = useI18n();

  const rename = useAction<[]>(
    {
      handler: async () => {
        const name = await dialog.prompt({
          title: tr("account.passkeys.renameTitle", {
            default: "Rename this passkey",
          }),
          label: tr("account.passkeys.nameLabel", { default: "Name" }),
          defaultValue: props.passkey.name,
          confirmLabel: tr("account.passkeys.rename", { default: "Rename" }),
        });
        if (!name) {
          return;
        }
        await api.renameMyPasskey({
          params: { id: props.passkey.id },
          body: { name },
        });
      },
      invalidates: [ACCOUNT_PASSKEYS_KEY],
    },
    [api, dialog, props.passkey.id, props.passkey.name, tr],
  );

  return (
    <SettingsRow
      label={
        <span className="inline-flex items-center gap-2">
          <Fingerprint className="size-4" />
          {props.passkey.name}
          {props.passkey.backedUp ? (
            <Badge>
              {tr("account.passkeys.synced", { default: "Synced" })}
            </Badge>
          ) : null}
          {!props.passkey.usable ? (
            <Badge>
              {tr("account.passkeys.unusable", { default: "Not usable here" })}
            </Badge>
          ) : null}
        </span>
      }
      description={props.lastUsed}
    >
      <div className="flex gap-2">
        <Button
          variant="minimal"
          size="sm"
          loading={rename.loading}
          onClick={() => void rename.run()}
          aria-label={tr("account.passkeys.renameAria", {
            default: "Rename $1",
            args: [props.passkey.name],
          })}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="minimal"
          size="sm"
          onClick={() => props.onRemove()}
          aria-label={tr("account.passkeys.removeAria", {
            default: "Remove $1",
            args: [props.passkey.name],
          })}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </SettingsRow>
  );
};
