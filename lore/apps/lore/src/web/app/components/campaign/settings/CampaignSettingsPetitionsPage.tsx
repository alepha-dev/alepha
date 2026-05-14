import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";
import { toast } from "sonner";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsFeatureSection from "./CampaignSettingsFeatureSection.tsx";
import CampaignSettingsPetitionsPageSnippet from "./CampaignSettingsPetitionsPageSnippet.tsx";
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
  href="${origin}/c/${campaign.id}/request?tags=${encodeURIComponent("type=bug")}"
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
    u.searchParams.append('tags', 'type=bug');
    u.searchParams.append('tags', 'host=' + location.host);
    u.searchParams.append('tags', 'path=' + location.pathname);
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

          <CampaignSettingsPetitionsPageSnippet
            label={String(tr("petitions.integrate.simple"))}
            code={linkSnippet}
            onCopy={() => copy(linkSnippet)}
            copyLabel={String(tr("petitions.integrate.copy"))}
          />

          <CampaignSettingsPetitionsPageSnippet
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

export default CampaignSettingsPetitionsPage;
