import CampaignSettingsFeatureSection from "./CampaignSettingsFeatureSection.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

const CampaignSettingsFoliosPage = () => {
  const { enabled, toggle } = useCampaignFeatureToggle("folios");
  return (
    <CampaignSettingsFeatureSection
      featureKey="folios"
      enabled={enabled}
      onToggle={toggle}
    />
  );
};

export default CampaignSettingsFoliosPage;
