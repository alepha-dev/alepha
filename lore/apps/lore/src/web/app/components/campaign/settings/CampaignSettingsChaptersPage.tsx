import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { z } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Hourglass } from "lucide-react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "@/web/app/atoms/userCampaignsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsFeatureSection from "./CampaignSettingsFeatureSection.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

const DURATION_SENTINEL_MANUAL = "manual";

const CampaignSettingsChaptersPage = () => {
  const { enabled, toggle } = useCampaignFeatureToggle("chapters");
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const campaignApi = useClient<CampaignController>();
  const alepha = useAlepha();

  const form = useForm({
    initialValues: {
      chapterDuration: campaign?.chapterDuration ?? DURATION_SENTINEL_MANUAL,
    },
    schema: z.object({
      chapterDuration: z.string().optional(),
    }),
    handler: async (values) => {
      if (!campaign) return;
      const duration =
        values.chapterDuration === DURATION_SENTINEL_MANUAL
          ? null
          : (values.chapterDuration ?? null);
      const updated = await campaignApi.updateCampaignById({
        params: { id: campaign.id },
        body: { chapterDuration: duration },
      });
      alepha.store.set(currentCampaignAtom, updated);
      const overview = alepha.store.get(userCampaignsAtom);
      if (overview) {
        alepha.store.set(userCampaignsAtom, {
          ...overview,
          campaigns: overview.campaigns.map((c) =>
            c.id === updated.id ? updated : c,
          ),
        });
      }
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <CampaignSettingsFeatureSection
        featureKey="chapters"
        enabled={enabled}
        onToggle={toggle}
      />
      {enabled && (
        <div className="flex flex-col gap-2">
          <span className="text-sm">
            {tr("campaign.settings.chapters.release.title")}
          </span>
          <AutoForm
            form={form}
            autoSave
            layout="row"
            groups={[{ fields: ["chapterDuration"] }]}
            fields={{
              chapterDuration: {
                icon: Hourglass,
                select: true,
                items: [
                  {
                    value: DURATION_SENTINEL_MANUAL,
                    label: String(
                      tr("campaign.settings.chapters.duration.manual"),
                    ),
                  },
                  {
                    value: "P7D",
                    label: tr("campaign.settings.chapters.duration.1w"),
                  },
                  {
                    value: "P14D",
                    label: tr("campaign.settings.chapters.duration.2w"),
                  },
                  {
                    value: "P1M",
                    label: String(
                      tr("campaign.settings.chapters.duration.1mo"),
                    ),
                  },
                  {
                    value: "P3M",
                    label: String(
                      tr("campaign.settings.chapters.duration.3mo"),
                    ),
                  },
                ],
              },
            }}
          />
        </div>
      )}
    </div>
  );
};

export default CampaignSettingsChaptersPage;
