import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { Switch } from "@alepha/ui/components/ui/switch";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BeaconController } from "@/api/controllers/BeaconController.ts";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface CampaignSettingsBeaconsSectionProps {
  campaignId: number;
}

const DEFAULT_RATE_LIMIT = 10;

const generateClientToken = (): string => {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `pk_${raw}`;
};

const maskToken = (token: string): string => {
  if (!token) {
    return "";
  }
  if (token.length <= 8) {
    return `${token}…`;
  }
  return `${token.slice(0, 8)}…`;
};

const CampaignSettingsBeaconsSection = (
  props: CampaignSettingsBeaconsSectionProps,
) => {
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const campaignApi = useClient<CampaignController>();
  const beaconApi = useClient<BeaconController>();

  const settings = campaign?.beacons;

  // Local form state — populated from settings, persisted on blur / save.
  const [originsText, setOriginsText] = useState("");
  const [rateLimit, setRateLimit] = useState<number>(DEFAULT_RATE_LIMIT);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  // Keep the local form in sync with atom changes (e.g. token regenerate).
  useEffect(() => {
    if (settings) {
      setOriginsText(settings.allowedOrigins.join("\n"));
      setRateLimit(settings.rateLimitPerMin ?? DEFAULT_RATE_LIMIT);
    } else {
      setOriginsText("");
      setRateLimit(DEFAULT_RATE_LIMIT);
    }
  }, [settings]);

  if (!campaign) {
    return null;
  }

  const persist = async (
    beacons:
      | {
          enabled: boolean;
          publicToken: string;
          allowedOrigins: string[];
          rateLimitPerMin?: number;
        }
      | undefined,
  ) => {
    setSaving(true);
    try {
      const updated = await campaignApi.updateCampaignById({
        params: { id: props.campaignId },
        body: { beacons },
      });
      alepha.store.set(currentCampaignAtom, updated);
    } catch (err: any) {
      toast.error(err?.message ?? String(tr("beacons.settings.saveError")));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (enabled && !settings) {
      await persist({
        enabled: true,
        publicToken: generateClientToken(),
        allowedOrigins: [],
        rateLimitPerMin: DEFAULT_RATE_LIMIT,
      });
      return;
    }
    if (!settings) {
      return;
    }
    await persist({ ...settings, enabled });
  };

  const parseOrigins = (raw: string): string[] =>
    raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const handleOriginsBlur = async () => {
    if (!settings) {
      return;
    }
    const next = parseOrigins(originsText);
    if (
      next.length === settings.allowedOrigins.length &&
      next.every((v, i) => v === settings.allowedOrigins[i])
    ) {
      return;
    }
    await persist({ ...settings, allowedOrigins: next });
  };

  const handleRateLimitBlur = async () => {
    if (!settings) {
      return;
    }
    const clamped = Math.min(60, Math.max(1, Math.floor(rateLimit) || 1));
    if (clamped !== rateLimit) {
      setRateLimit(clamped);
    }
    if (clamped === (settings.rateLimitPerMin ?? DEFAULT_RATE_LIMIT)) {
      return;
    }
    await persist({ ...settings, rateLimitPerMin: clamped });
  };

  const handleRegenerate = async () => {
    if (!settings) {
      return;
    }
    setSaving(true);
    try {
      const { publicToken } = await beaconApi.regenerateToken({
        params: { campaignId: props.campaignId },
      });
      alepha.store.set(currentCampaignAtom, {
        ...campaign,
        beacons: { ...settings, publicToken },
      });
      toast.success(String(tr("beacons.settings.regenerated")));
    } catch (err: any) {
      toast.error(
        err?.message ?? String(tr("beacons.settings.regenerateError")),
      );
    } finally {
      setSaving(false);
    }
  };

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://example";
  const snippet = settings
    ? `<script async src="${origin}/c/${props.campaignId}/bt.js?t=${settings.publicToken}"></script>`
    : "";

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(String(tr("beacons.settings.copyError")));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">{tr("beacons.settings.title")}</span>
      <Card className="bg-card shadow">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0">
              <span className="text-sm font-medium">
                {tr("beacons.settings.enable")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("beacons.settings.enableHelp")}
              </span>
            </div>
            <Switch
              checked={!!settings?.enabled}
              disabled={saving}
              onCheckedChange={(v) => handleToggle(v === true)}
            />
          </div>

          {settings?.enabled && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>{tr("beacons.settings.snippet")}</Label>
                <div className="relative">
                  <pre className="bg-muted text-foreground overflow-x-auto rounded-md p-3 pr-12 text-xs">
                    <code>{snippet}</code>
                  </pre>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="absolute top-1.5 right-1.5"
                    onClick={handleCopySnippet}
                  >
                    {copied ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
                <span className="text-muted-foreground text-xs">
                  {tr("beacons.settings.snippetHelp")}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{tr("beacons.settings.token")}</Label>
                <div className="flex items-center gap-2">
                  <code className="bg-muted flex-1 truncate rounded-md px-3 py-2 font-mono text-xs">
                    {maskToken(settings.publicToken)}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={handleRegenerate}
                  >
                    <RefreshCw className="size-3.5" />
                    {tr("beacons.settings.regenerate")}
                  </Button>
                </div>
                <span className="text-muted-foreground text-xs">
                  {tr("beacons.settings.regenerateWarning")}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{tr("beacons.settings.allowedOrigins")}</Label>
                <Textarea
                  rows={4}
                  placeholder={"https://app.example.com\n*.example.com"}
                  value={originsText}
                  disabled={saving}
                  onChange={(e) => setOriginsText(e.currentTarget.value)}
                  onBlur={handleOriginsBlur}
                />
                <span className="text-muted-foreground text-xs">
                  {tr("beacons.settings.allowedOriginsHelp")}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{tr("beacons.settings.rateLimit")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={rateLimit}
                  disabled={saving}
                  onChange={(e) =>
                    setRateLimit(Number(e.currentTarget.value) || 1)
                  }
                  onBlur={handleRateLimitBlur}
                />
                <span className="text-muted-foreground text-xs">
                  {tr("beacons.settings.rateLimitHelp", {
                    args: [String(DEFAULT_RATE_LIMIT)],
                  })}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CampaignSettingsBeaconsSection;
