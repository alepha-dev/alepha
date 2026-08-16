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
      toaster.show(error?.message ?? "Could not create that key", "danger");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: ApiKeyRow) => {
    const ok = await dialog.confirm({
      title: `Revoke ${key.name}?`,
      description:
        "Anything still using this key stops working immediately. This cannot be undone.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) {
      return;
    }
    try {
      await api.revokeMyApiKey({ params: { id: key.id } });
      setKeys((prev) => prev.filter((it) => it.id !== key.id));
    } catch (error: any) {
      toaster.show(error?.message ?? "Could not revoke that key", "danger");
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
        title="API keys"
        description="Keys act as you. Revoke any you no longer recognise."
      >
        {keys.map((key) => (
          <SettingsRow
            key={key.id}
            label={key.name}
            description={`…${key.tokenSuffix} · created ${dt
              .of(key.createdAt)
              .fromNow()}${
              key.lastUsedAt
                ? ` · last used ${dt.of(key.lastUsedAt).fromNow()}`
                : " · never used"
            }`}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => revoke(key)}
              aria-label={`Revoke ${key.name}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </SettingsRow>
        ))}

        <SettingsRow
          label="Create a key"
          description="Shown once, at creation. It cannot be recovered afterwards."
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
            New key
          </Button>
        </SettingsRow>
      </SettingsSection>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apiKeyName">Name</Label>
              <Input
                id="apiKeyName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CI pipeline"
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                Create
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
            <DialogTitle>Copy your key now</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <span className="text-muted-foreground text-sm">
              This is the only time it is shown. Store it somewhere safe before
              closing this dialog.
            </span>
            <code className="break-all rounded-md border bg-muted p-3 font-mono text-xs">
              {freshToken}
            </code>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={copy}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Clipboard className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                onClick={() => {
                  setFreshToken(undefined);
                  setCopied(false);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AccountKeys;
