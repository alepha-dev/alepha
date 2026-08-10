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
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { ApiKeyController } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Check, Clipboard, Key, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { I18n } from "../../services/I18n.ts";

interface ApiKey {
  id: string;
  name: string;
  tokenSuffix: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface MyApiKeysProps {
  apiKeys: ApiKey[];
}

const MyApiKeys = (props: MyApiKeysProps) => {
  const dt = useInject(DateTimeProvider);
  const apiKeyApi = useClient<ApiKeyController>();
  const toaster = useToast();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(props.apiKeys);
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = () => {
    setOpened(false);
    setName("");
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await apiKeyApi.createApiKey({ body: { name } });
      setApiKeys((prev) => [
        {
          id: result.id,
          name: result.name,
          tokenSuffix: result.tokenSuffix,
          createdAt: result.createdAt,
          lastUsedAt: undefined,
          expiresAt: result.expiresAt,
        },
        ...prev,
      ]);
      setNewToken(result.token);
      close();
    } catch (error: any) {
      toaster.show(error?.message || "Failed to create API key", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Confirmed, unlike the other revokes in this profile area, because this one
   * is unrecoverable AND its damage is invisible from here: the key is shown
   * once at creation, cannot be re-issued as the same value, and every Claude
   * client configured with it stops working. The rows are told apart only by a
   * nickname and a truncated suffix, which is exactly the situation where a
   * misclick is plausible and its consequence unclear.
   */
  const handleRevoke = async (key: ApiKey) => {
    const ok = await dialog.confirm({
      title: String(tr("profile.apiKeys.revoke.title", { args: [key.name] })),
      description: String(tr("profile.apiKeys.revoke.description")),
      confirmLabel: String(tr("profile.apiKeys.revoke.confirm")),
      destructive: true,
    });
    if (!ok) {
      return;
    }

    await apiKeyApi.revokeMyApiKey({ params: { id: key.id } });
    setApiKeys((prev) => prev.filter((it) => it.id !== key.id));
  };

  const handleCopy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex w-full flex-col gap-2 p-2">
      <div className="flex items-center justify-between p-2">
        <span className="text-xs text-muted-foreground">
          MCP API keys allow Claude and other LLM clients to access all your
          projects.
        </span>
        <Button size="sm" onClick={() => setOpened(true)}>
          <Plus className="size-3.5" />
          Create Key
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
        {apiKeys.length === 0 ? (
          <span className="py-4 text-center text-sm text-muted-foreground">
            No API keys yet. Create one to connect Claude or other MCP clients.
          </span>
        ) : (
          apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between rounded-md border border-border bg-muted/40 p-3"
            >
              <div className="flex items-center gap-3">
                <Key className="size-5" />
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{key.name}</span>
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      ...{key.tokenSuffix}
                    </code>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Created {dt.of(key.createdAt).fromNow()}</span>
                    {key.lastUsedAt && (
                      <>
                        <span>|</span>
                        <span>Last used {dt.of(key.lastUsedAt).fromNow()}</span>
                      </>
                    )}
                    {key.expiresAt && (
                      <Badge variant="secondary" className="text-xs">
                        Expires {dt.of(key.expiresAt).fromNow()}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-red-500 hover:text-red-600"
                onClick={() => void handleRevoke(key)}
                aria-label="Revoke key"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <Dialog open={opened} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create MCP API Key</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="keyName">Key Name</Label>
              <Input
                id="keyName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Claude Desktop"
                minLength={1}
                maxLength={100}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newToken} onOpenChange={(o) => !o && setNewToken(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <span className="text-sm">
              Copy this API key now. You won't be able to see it again.
            </span>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 break-all rounded-md border border-border bg-muted p-3 text-xs">
                {newToken}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleCopy(newToken || "")}
                className={copied ? "text-green-500" : ""}
                aria-label="Copy"
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Clipboard className="size-4" />
                )}
              </Button>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
              <span className="text-xs font-medium">Claude Code</span>
              <code className="break-all rounded bg-muted p-2 text-[11px]">
                {`claude mcp add lore ${typeof window !== "undefined" ? window.location.origin : ""}/mcp -t http -H "Authorization: Bearer ${newToken}"`}
              </code>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
              <span className="text-xs font-medium">
                MCP Configuration (JSON)
              </span>
              <code className="break-all rounded bg-muted p-2 text-[11px]">
                {JSON.stringify(
                  {
                    type: "sse",
                    url: `${typeof window !== "undefined" ? window.location.origin : ""}/mcp`,
                    headers: { Authorization: `Bearer ${newToken}` },
                  },
                  null,
                  2,
                )}
              </code>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
              <span className="text-xs font-medium">Claude Desktop</span>
              <code className="break-all rounded bg-muted p-2 text-[11px]">
                {`${typeof window !== "undefined" ? window.location.origin : ""}/mcp?api_key=${newToken}`}
              </code>
            </div>
            <span className="text-xs text-muted-foreground">
              This key gives access to all your projects. Use the project_list
              tool to see available projects, then specify project_name in other
              tools.
            </span>
            <div className="flex justify-end">
              <Button onClick={() => setNewToken(null)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyApiKeys;
