import { Button } from "@alepha/ui/components/ui/button";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Copy } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsFeatureSection from "./CampaignSettingsFeatureSection.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

const CampaignSettingsPetitionsPage = () => {
  const { enabled, toggle } = useCampaignFeatureToggle("petitions");
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://lore.dev";

  const linkSnippet = useMemo(() => {
    if (!campaign) return "";
    return `<a
  href="${origin}/c/${campaign.id}/request?type=bug"
  target="_blank"
  rel="noopener noreferrer"
>
  Report a bug
</a>`;
  }, [campaign?.id, origin]);

  const dynamicSnippet = useMemo(() => {
    if (!campaign) return "";
    return `<a id="lore-report" target="_blank" rel="noopener noreferrer">Report a bug</a>
<script>
  (function () {
    var a = document.getElementById('lore-report');
    var u = new URL('${origin}/c/${campaign.id}/request');
    u.searchParams.set('type', 'bug');
    u.searchParams.set('url', location.href);
    u.searchParams.set('path', location.pathname);
    a.href = u.toString();
  })();
</script>`;
  }, [campaign?.id, origin]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(String(tr("petitions.integrate.copied")));
  };

  return (
    <div className="flex flex-col gap-6">
      <CampaignSettingsFeatureSection
        featureKey="petitions"
        enabled={enabled}
        onToggle={toggle}
      />

      {enabled && campaign && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm">{tr("petitions.integrate.title")}</span>
            <span className="text-muted-foreground text-xs">
              {tr("petitions.integrate.helper")}
            </span>
          </div>

          <Snippet
            label={String(tr("petitions.integrate.simple"))}
            code={linkSnippet}
            onCopy={() => copy(linkSnippet)}
            copyLabel={String(tr("petitions.integrate.copy"))}
          />

          <Snippet
            label={String(tr("petitions.integrate.dynamic"))}
            code={dynamicSnippet}
            onCopy={() => copy(dynamicSnippet)}
            copyLabel={String(tr("petitions.integrate.copy"))}
          />
        </div>
      )}
    </div>
  );
};

interface SnippetProps {
  label: string;
  code: string;
  onCopy: () => void;
  copyLabel: string;
}

const Snippet = (props: SnippetProps) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-wide">
        {props.label}
      </span>
      <Button variant="outline" size="sm" onClick={props.onCopy}>
        <Copy className="size-3.5" />
        {props.copyLabel}
      </Button>
    </div>
    <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md border p-3 font-mono text-xs">
      {props.code}
    </pre>
  </div>
);

export default CampaignSettingsPetitionsPage;
