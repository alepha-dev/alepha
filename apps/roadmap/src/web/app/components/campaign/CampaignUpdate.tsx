import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Card } from "@alepha/ui/components/ui/card";
import { t } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Tag } from "lucide-react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { Campaign } from "@/api/entities/campaigns.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export interface CampaignUpdateProps {
  campaign: Campaign;
}

const CampaignUpdate = (props: CampaignUpdateProps) => {
  const campaignApi = useClient<CampaignController>();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  const form = useForm({
    initialValues: props.campaign,
    schema: t.object({
      title: t.optional(
        t.string({
          title: String(tr("campaign.create.name")),
          minLength: 3,
          maxLength: 24,
        }),
      ),
      public: t.optional(
        t.boolean({
          title: String(tr("campaign.create.public")),
          description: String(tr("campaign.create.public.helper")),
        }),
      ),
    }),
    handler: async (values) => {
      const campaign = await campaignApi.updateCampaignById({
        params: { id: props.campaign.id },
        body: values,
      });

      alepha.store.set(currentCampaignAtom, campaign);
      alepha.store.set(userCampaignsAtom, [
        ...(alepha.store.get(userCampaignsAtom) ?? []).filter(
          (p) => p.id !== campaign.id,
        ),
        campaign,
      ]);
    },
  });

  return (
    <Card className="bg-card p-4 shadow">
      <AutoForm
        form={form}
        fields={{
          title: {
            icon: Tag,
          },
        }}
        submitLabel={String(tr("campaign.update.submit"))}
      />
    </Card>
  );
};

export default CampaignUpdate;
