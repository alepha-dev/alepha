import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { Infer } from "alepha";
import type { ApiKeyController, listApiKeyItemSchema } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Check, Clipboard, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

/**
 * Derived from the framework's own response schema rather than restated, so a
 * field added to the endpoint is available here the day it lands — and a
 * field removed is a compile error rather than a blank cell.
 */
type ApiKeyRow = Infer<typeof listApiKeyItemSchema>;

export interface AccountKeysProps {
  apiKeys?: ApiKeyRow[];
}

/**
 * Your own API keys: mint, see, revoke.
 *
 * The freshly created token is shown **once**, in a dialog that stays open
 * until dismissed, because the server stores only a hash and cannot show it
 * again. That is also why the create form and the reveal are separate steps
 * rather than one inline row — a token that scrolls out of view behind a
 * re-render is gone.
 */
const AccountKeys = (props: AccountKeysProps) => {
  const api = useClient<ApiKeyController>();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const toaster = useToast();
  const { tr } = useI18n();

  const [keys, setKeys] = useState<ApiKeyRow[]>(props.apiKeys ?? []);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      const created: any = await api.createApiKey({ body: { name } });
      setFreshToken(created.token);
      setKeys(await (api.listApiKeys() as Promise<any>));
      setName("");
      setCreateOpen(false);
    } catch (error: any) {
      toaster.show(
        error?.message ??
          tr("account.keys.createError", {
            default: "Could not create that key",
          }),
        "danger",
      );
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: ApiKeyRow) => {
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
      setKeys((prev) => prev.filter((it) => it.id !== key.id));
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
        {keys.map((key) => (
          <SettingsRow
            key={key.id}
            label={key.name}
            description={
              tr("account.keys.createdAt", {
                default: "…$1 · created $2",
                args: [key.tokenSuffix, dt.of(key.createdAt).fromNow()],
              }) +
              (key.lastUsedAt
                ? tr("account.keys.lastUsedAt", {
                    default: " · last used $1",
                    args: [dt.of(key.lastUsedAt).fromNow()],
                  })
                : tr("account.keys.neverUsed", { default: " · never used" }))
            }
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => revoke(key)}
              aria-label={tr("account.keys.revokeAria", {
                default: "Revoke $1",
                args: [key.name],
              })}
            >
              <Trash2 className="size-4" />
            </Button>
          </SettingsRow>
        ))}

        <SettingsRow
          label={tr("account.keys.create", { default: "Create a key" })}
          description={tr("account.keys.createDescription", {
            default:
              "Shown once, at creation. It cannot be recovered afterwards.",
          })}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
            {tr("account.keys.new", { default: "New key" })}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("account.keys.newTitle", { default: "New API key" })}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apiKeyName">
                {tr("account.keys.name", { default: "Name" })}
              </Label>
              <Input
                id="apiKeyName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={tr("account.keys.namePlaceholder", {
                  default: "CI pipeline",
                })}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                {tr("account.keys.cancel", { default: "Cancel" })}
              </Button>
              <Button type="submit" disabled={creating}>
                {tr("account.keys.submit", { default: "Create" })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={copy}>
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
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AccountKeys;
