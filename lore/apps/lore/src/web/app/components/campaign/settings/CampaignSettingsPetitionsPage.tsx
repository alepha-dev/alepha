import { useI18n } from "alepha/react/i18n";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsFeatureSection from "./CampaignSettingsFeatureSection.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

const CampaignSettingsPetitionsPage = () => {
  const { enabled, toggle } = useCampaignFeatureToggle("petitions");
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex flex-col gap-6">
      <CampaignSettingsFeatureSection
        featureKey="petitions"
        enabled={enabled}
        onToggle={toggle}
      />
    </div>
  );
};

export default CampaignSettingsPetitionsPage;
