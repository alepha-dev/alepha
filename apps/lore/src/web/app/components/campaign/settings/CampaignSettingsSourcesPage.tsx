import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { AlertCircle, Copy, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CampaignSourceController } from "@/api/controllers/CampaignSourceController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";

interface SourceRow {
  id: string;
  name: string;
  tokenPrefix: string;
  tokenSuffix: string;
  scopes: string[];
  createdAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
}

/**
 * Which systems may file blights into this campaign.
 *
 * A source is a credential for an *observer* — a Pulse — that has already
 * deduplicated what it sends. It replaces sigils, which were credentials handed
 * to websites so they could push raw telemetry straight here.
 *
 * The key appears exactly once, on creation. It is stored hashed, so nothing
 * can show it again; losing it means creating another and revoking this one.
 */
const CampaignSettingsSourcesPage = () => {
  const toaster = useToast();
  const dialog = useDialog();
  const api = useClient<CampaignSourceController>();
  const [campaign] = useStore(currentCampaignAtom);

  const [sources, setSources] = useState<SourceRow[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  /** The one moment a key is readable. Cleared as soon as it is dismissed. */
  const [freshToken, setFreshToken] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!campaign) return;
    const res = await api.listSources({ params: { campaignId: campaign.id } });
    setSources(res.items as SourceRow[]);
  }, [api, campaign]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!campaign || !name.trim()) return;
    setCreating(true);
    try {
      const res = await api.createSource({
        params: { campaignId: campaign.id },
        body: { name: name.trim() },
      });
      setFreshToken(res.token);
      setName("");
      await load();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (source: SourceRow) => {
    if (!campaign) return;
    const confirmed = await dialog.confirm({
      title: `Revoke “${source.name}”?`,
      description:
        "It stops being able to file blights immediately. What it already reported is kept, and stays attributed to it.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await api.revokeSource({
        params: { campaignId: campaign.id, id: source.id },
      });
      await load();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (!campaign) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Sources</span>
        <span className="text-muted-foreground text-xs">
          Systems allowed to file blights into this campaign — typically a Pulse
          instance. Each holds its own key and can be revoked on its own.
        </span>
      </div>

      {freshToken && (
        <Alert>
          <AlertCircle />
          <AlertDescription className="flex flex-col gap-2">
            <span>
              Copy this key now — it is stored hashed and will never be shown
              again.
            </span>
            <div className="flex items-center gap-2">
              <code className="bg-muted grow overflow-x-auto rounded px-2 py-1 font-mono text-xs">
                {freshToken}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(freshToken);
                  toaster.success("Key copied");
                }}
              >
                <Copy />
              </Button>
              <Button size="sm" onClick={() => setFreshToken(undefined)}>
                Done
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={name}
          placeholder="Pulse (production)"
          onChange={(event) => setName(event.target.value)}
        />
        <Button onClick={create} disabled={!name.trim() || creating}>
          <Plus />
          Enrol
        </Button>
      </div>

      <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
        {sources.length === 0 && (
          <CardContent className="px-4 py-6">
            <span className="text-muted-foreground text-sm">
              No source yet. Until one is enrolled, nothing can file blights
              here.
            </span>
          </CardContent>
        )}
        {sources.map((source) => (
          <CardContent
            key={source.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{source.name}</span>
                {source.revokedAt && (
                  <Badge variant="destructive">Revoked</Badge>
                )}
              </div>
              <span className="text-muted-foreground font-mono text-xs">
                {source.tokenPrefix}…{source.tokenSuffix}
              </span>
            </div>
            <span className="text-muted-foreground text-xs">
              {/*
                What an operator actually checks: not when the key was made,
                but whether the thing holding it is still reporting.
              */}
              {source.lastSeenAt
                ? `last seen ${new Date(source.lastSeenAt).toLocaleString()}`
                : "never reported"}
            </span>
            {!source.revokedAt && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => revoke(source)}
              >
                Revoke
              </Button>
            )}
          </CardContent>
        ))}
      </Card>
    </div>
  );
};

export default CampaignSettingsSourcesPage;
