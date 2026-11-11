import type {
  MyPasskey,
  MyPasskeyController,
  MyPasskeyList,
  PasskeyProof,
  RealmConfig,
} from "alepha/api/users";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { ACCOUNT_PASSKEYS_KEY, usePasskey } from "../auth/usePasskey.ts";
import { Button } from "../core/Button.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { SettingsRow } from "../settings/SettingsRow.tsx";
import { SettingsSection } from "../settings/SettingsSection.tsx";
import { AccountPasskeyProofDialog } from "./AccountPasskeyProofDialog.tsx";
import { AccountPasskeyRow } from "./AccountPasskeyRow.tsx";

export interface AccountPasskeysProps {
  /**
   * Carries `settings.passkeys`. Absent, the card renders when the browser
   * supports passkeys, and the server refuses an enrolment the realm does
   * not offer.
   */
  realmConfig?: RealmConfig;

  /**
   * Called with the list each time it loads, so the page can count the
   * usable passkeys among the ways to sign in.
   */
  onLoaded?: (list: MyPasskeyList) => void;
}

/**
 * The account's passkeys: list, add, rename, remove.
 *
 * Adding and removing ask first for the proof the server names in the
 * list's `proof`: the current password, a confirmation with a passkey the
 * account already holds, or nothing. Hidden when the realm does not offer
 * passkeys or the browser cannot use them, except that passkeys enrolled
 * before the realm turned them off stay listed and removable.
 */
export const AccountPasskeys = (props: AccountPasskeysProps) => {
  const api = useClient<MyPasskeyController>();
  const dialog = useDialog();
  const { l, tr } = useI18n();
  const [proofFor, setProofFor] = useState<
    { purpose: "add"; name: string } | { purpose: "remove"; id: string }
  >();

  const direct = usePasskey();
  // The proof dialog shows the error of the write it ran on its own field.
  const proved = usePasskey({ onError: useCallback(() => {}, []) });

  const { data: list } = useQuery<MyPasskeyList>(
    {
      key: ACCOUNT_PASSKEYS_KEY,
      handler: async () => {
        const result = (await api.getMyPasskeys()) as MyPasskeyList;
        props.onLoaded?.(result);
        return result;
      },
    },
    [],
  );

  const offered = props.realmConfig?.settings?.passkeys !== "disabled";
  const items = list?.items ?? [];
  if ((!offered || !direct.supported) && items.length === 0) {
    return null;
  }

  const startAdd = async () => {
    const name = await dialog.prompt({
      title: tr("account.passkeys.nameTitle", { default: "Name this passkey" }),
      description: tr("account.passkeys.nameDescription", {
        default: "So you can tell it apart from your other passkeys.",
      }),
      label: tr("account.passkeys.nameLabel", { default: "Name" }),
      defaultValue: deviceLabel(),
      confirmLabel: tr("account.passkeys.add", { default: "Add a passkey" }),
    });
    if (!name) {
      return;
    }
    if (list?.proof === "none") {
      await direct.register(undefined, name);
      return;
    }
    setProofFor({ purpose: "add", name });
  };

  const startRemove = async (passkey: MyPasskey) => {
    const ok = await dialog.confirm({
      title: tr("account.passkeys.removeTitle", {
        default: "Remove $1?",
        args: [passkey.name],
      }),
      description: tr("account.passkeys.removeDescription", {
        default: "You will no longer be able to sign in with this passkey.",
      }),
      confirmLabel: tr("account.passkeys.remove", { default: "Remove" }),
      destructive: true,
    });
    if (!ok) {
      return;
    }
    if (list?.proof === "none") {
      await direct.remove(passkey.id, undefined);
      return;
    }
    setProofFor({ purpose: "remove", id: passkey.id });
  };

  return (
    <SettingsSection
      title={tr("account.passkeys.title", { default: "Passkeys" })}
      description={tr("account.passkeys.description", {
        default:
          "Sign in with your fingerprint, face or device PIN instead of a password.",
      })}
    >
      {items.map((passkey) => (
        <AccountPasskeyRow
          key={passkey.id}
          passkey={passkey}
          lastUsed={
            passkey.lastUsedAt
              ? tr("account.passkeys.lastUsed", {
                  default: "Added $1, last used $2",
                  args: [
                    l(passkey.createdAt, { date: "ll" }),
                    l(passkey.lastUsedAt, { date: "ll" }),
                  ],
                })
              : tr("account.passkeys.neverUsed", {
                  default: "Added $1, never used",
                  args: [l(passkey.createdAt, { date: "ll" })],
                })
          }
          onRemove={() => void startRemove(passkey)}
        />
      ))}
      {offered && direct.supported ? (
        <SettingsRow
          label={tr("account.passkeys.add", { default: "Add a passkey" })}
          description={tr("account.passkeys.addHint", {
            default: "Use this device, or a phone or security key.",
          })}
        >
          <Button
            variant="solid"
            intent="none"
            size="sm"
            loading={direct.loading}
            onClick={() => void startAdd()}
          >
            <Plus className="size-4" />
            {tr("account.passkeys.add", { default: "Add a passkey" })}
          </Button>
        </SettingsRow>
      ) : null}

      <AccountPasskeyProofDialog
        kind={
          proofFor && list && list.proof !== "none" ? list.proof : undefined
        }
        purpose={proofFor?.purpose ?? "add"}
        prove={proved.prove}
        onProof={(proof: PasskeyProof) =>
          proofFor?.purpose === "remove"
            ? proved.remove(proofFor.id, proof)
            : proved.register(
                proof,
                proofFor?.purpose === "add" ? proofFor.name : "",
              )
        }
        onClose={() => setProofFor(undefined)}
      />
    </SettingsSection>
  );
};

/**
 * A default name for a new passkey, from the user agent: "Chrome on macOS".
 */
const deviceLabel = (): string => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
};
