import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
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
    initialValues: {
      icon: props.campaign.icon,
      title: props.campaign.title,
    },
    schema: t.object({
      icon: t.optional(t.nullable(t.uuid())),
      title: t.string({
        title: String(tr("campaign.create.name")),
        minLength: 3,
        maxLength: 24,
      }),
    }),
    handler: async (values) => {
      const campaign = await campaignApi.updateCampaignById({
        params: { id: props.campaign.id },
        body: {
          ...values,
          // Force null so the server can distinguish "cleared" from "absent".
          icon: values.icon ?? null,
        },
      });

      alepha.store.set(currentCampaignAtom, campaign);
      const overview = alepha.store.get(userCampaignsAtom);
      if (overview) {
        alepha.store.set(userCampaignsAtom, {
          ...overview,
          campaigns: overview.campaigns.map((p) =>
            p.id === campaign.id ? campaign : p,
          ),
        });
      }
    },
  });

  return (
    <AutoForm
      form={form}
      layout="row"
      autoSave
      groups={[{ fields: ["icon", "title"] }]}
      fields={{
        icon: {
          label: "Icon",
          upload: {
            accept: "image/*",
            maxSize: 2 * 1024 * 1024,
            bucket: "campaign-icons",
          },
        },
        title: {
          icon: Tag,
        },
      }}
    />
  );
};

export default CampaignUpdate;
