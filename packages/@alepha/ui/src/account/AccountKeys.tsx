import type { ApiKeyController, ListApiKeyItem } from "alepha/api/keys";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Plus,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { SettingsRow } from "../settings/SettingsRow.tsx";
import { SettingsSection } from "../settings/SettingsSection.tsx";
import { AccountKeysRow } from "./AccountKeysRow.tsx";
import { ApiKeyCreateDialog } from "./ApiKeyCreateDialog.tsx";

export interface AccountKeysProps {
  /**
   * The rows `GET /api-keys` returns, live and dead: the framework's own
   * response type, so a field added to the endpoint is available here the
   * day it lands.
   */
  apiKeys?: ListApiKeyItem[];
}

/**
 * Your own API keys: mint, rotate, revoke, and see where each is in its life.
 *
 * The freshly created or rotated token is shown **once**, in a dialog that
 * stays open until dismissed, because the server stores only a hash and
 * cannot show it again. That is also why minting and the reveal are separate
 * steps rather than one inline row - a token that scrolls out of view behind a
 * re-render is gone.
 *
 * Live keys come first. Expired and revoked keys follow in a collapsed
 * "Inactive keys" section: they are listed because a key that stopped working
 * is the one a user comes looking for, and folded away because a panel that
 * reads "14 keys" when 11 are dead misleads.
 */
const AccountKeys = (props: AccountKeysProps) => {
  const api = useClient<ApiKeyController>();
  const dialog = useDialog();
  const toaster = useToast();
  const { tr } = useI18n();

  const [keys, setKeys] = useState<ListApiKeyItem[]>(props.apiKeys ?? []);
  const [createOpen, setCreateOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [freshToken, setFreshToken] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const live = keys.filter(
    (key) => key.status === "active" || key.status === "expiring",
  );
  const inactive = keys.filter(
    (key) => key.status === "expired" || key.status === "revoked",
  );

  const reload = async () => {
    setKeys((await api.listApiKeys()) as ListApiKeyItem[]);
  };

  const rotate = async (key: ListApiKeyItem) => {
    const ok = await dialog.confirm({
      title: tr("account.keys.rotateTitle", {
        default: "Rotate $1?",
        args: [key.name],
      }),
      description: tr("account.keys.rotateDescription", {
        default:
          "The current secret stops working immediately, and a new one is shown once. Update wherever the key is stored.",
      }),
      confirmLabel: tr("account.keys.rotate", { default: "Rotate" }),
    });
    if (!ok) {
      return;
    }
    try {
      const rotated: any = await api.rotateMyApiKey({
        params: { id: key.id },
        body: {},
      });
      setFreshToken(rotated.token);
      await reload();
    } catch (error: any) {
      toaster.show(
        error?.message ??
          tr("account.keys.rotateError", {
            default: "Could not rotate that key",
          }),
        "danger",
      );
    }
  };

  const revoke = async (key: ListApiKeyItem) => {
    const ok = await dialog.confirm({
      title: tr("account.keys.revokeTitle", {
        default: "Revoke $1?",
        args: [key.name],
      }),
      description: tr("account.keys.revokeDescription", {
        default:
          "Anything still using this key stops working immediately. This cannot be undone.",
      }),
      confirmLabel: tr("account.keys.revoke", { default: "Revoke" }),
      destructive: true,
    });
    if (!ok) {
      return;
    }
    try {
      await api.revokeMyApiKey({ params: { id: key.id } });
      // Re-read rather than drop the row: a revoked key stays listed, with
      // its status, until the retention window purges it.
      await reload();
    } catch (error: any) {
      toaster.show(
        error?.message ??
          tr("account.keys.revokeError", {
            default: "Could not revoke that key",
          }),
        "danger",
      );
    }
  };

  const copy = async () => {
    if (!freshToken) {
      return;
    }
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
  };

  return (
    <>
      <SettingsSection
        title={tr("account.keys.title", { default: "API keys" })}
        description={tr("account.keys.description", {
          default: "Keys act as you. Revoke any you no longer recognise.",
        })}
      >
        {live.map((key) => (
          <AccountKeysRow
            key={key.id}
            apiKey={key}
            onRotate={rotate}
            onRevoke={revoke}
          />
        ))}

        <SettingsRow
          label={tr("account.keys.create", { default: "Create a key" })}
          description={tr("account.keys.createDescription", {
            default:
              "Shown once, at creation. It cannot be recovered afterwards.",
          })}
        >
          <Button
            variant="solid"
            intent="none"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
            {tr("account.keys.new", { default: "New key" })}
          </Button>
        </SettingsRow>
      </SettingsSection>

      {inactive.length > 0 ? (
        <SettingsSection
          title={tr("account.keys.inactiveTitle", {
            default: "Inactive keys",
          })}
          description={tr("account.keys.inactiveDescription", {
            default:
              "Expired and revoked keys, kept for a while so you can tell what stopped working. An expired key can be rotated to renew it.",
          })}
        >
          <SettingsRow
            label={tr("account.keys.inactiveCount", {
              default: "$1 inactive key(s)",
              args: [String(inactive.length)],
            })}
          >
            <Button
              variant="minimal"
              size="sm"
              aria-expanded={showInactive}
              onClick={() => setShowInactive((open) => !open)}
            >
              {showInactive ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              {showInactive
                ? tr("account.keys.hideInactive", { default: "Hide" })
                : tr("account.keys.showInactive", { default: "Show" })}
            </Button>
          </SettingsRow>
          {showInactive
            ? inactive.map((key) => (
                <AccountKeysRow
                  key={key.id}
                  apiKey={key}
                  onRotate={rotate}
                  onRevoke={revoke}
                />
              ))
            : null}
        </SettingsSection>
      ) : null}

      <ApiKeyCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingKeys={keys}
        onCreated={async (token) => {
          setFreshToken(token);
          await reload();
        }}
      />

      {/* Deliberately not auto-dismissed: this is the only time the token
          exists in a readable form. */}
      <Dialog
        open={Boolean(freshToken)}
        onOpenChange={(next) => {
          if (!next) {
            setFreshToken(undefined);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("account.keys.revealTitle", { default: "Copy your key now" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <span className="text-muted-foreground text-sm">
              {tr("account.keys.revealDescription", {
                default:
                  "This is the only time it is shown. Store it somewhere safe before closing this dialog.",
              })}
            </span>
            <code className="bg-muted rounded-md border p-3 font-mono text-xs break-all">
              {freshToken}
            </code>
            <DialogFooter>
              <Button variant="solid" intent="none" onClick={copy}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Clipboard className="size-4" />
                )}
                {copied
                  ? tr("account.keys.copied", { default: "Copied" })
                  : tr("account.keys.copy", { default: "Copy" })}
              </Button>
              <Button
                onClick={() => {
                  setFreshToken(undefined);
                  setCopied(false);
                }}
              >
                {tr("account.keys.done", { default: "Done" })}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AccountKeys;
