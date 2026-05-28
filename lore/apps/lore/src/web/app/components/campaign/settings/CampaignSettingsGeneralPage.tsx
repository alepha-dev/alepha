import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignUpdate from "../CampaignUpdate.tsx";
import CampaignSettingsDangerZoneSection from "./CampaignSettingsDangerZoneSection.tsx";
import CampaignSettingsDataSection from "./CampaignSettingsDataSection.tsx";
import CampaignSettingsDebugSection from "./CampaignSettingsDebugSection.tsx";

const CampaignSettingsGeneralPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const router = useRouter();
  // `?debug` query param gates the Debug section. Any value (including
  // empty) unlocks it — `?debug`, `?debug=1`, `?debug=true` all work.
  const debugEnabled = router.query.debug !== undefined;

  if (!campaign) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="text-sm">{tr("campaign.settings.general.title")}</span>
        <CampaignUpdate campaign={campaign} />
      </div>

      <CampaignSettingsDataSection />

      {debugEnabled && <CampaignSettingsDebugSection />}

      <CampaignSettingsDangerZoneSection />
    </div>
  );
};

export default CampaignSettingsGeneralPage;
