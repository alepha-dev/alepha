import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { t } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Globe2, Lock, Tag } from "lucide-react";
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
      icon: t.optional(t.nullable(t.uuid())),
      title: t.string({
        title: String(tr("campaign.create.name")),
        minLength: 3,
        maxLength: 24,
      }),
      public: t.optional(
        t.boolean({
          title: "Visibility",
          description: "Public campaign will be visible by the outside world.",
        }),
      ),
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
      groups={[{ fields: ["icon", "title", "public"] }]}
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
        public: {
          select: true,
          items: [
            {
              value: "true",
              label: "Public",
              icon: <Globe2 className="size-4" />,
            },
            {
              value: "false",
              label: "Private",
              icon: <Lock className="size-4" />,
            },
          ],
        },
      }}
    />
  );
};

export default CampaignUpdate;
