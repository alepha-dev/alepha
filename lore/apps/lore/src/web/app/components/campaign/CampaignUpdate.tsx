import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { z } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Languages, Tag } from "lucide-react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { Campaign } from "@/api/entities/campaigns.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export interface CampaignUpdateProps {
  campaign: Campaign;
}

/**
 * Radix Select rejects `value=""` (reserved as "no selection"). The
 * "No preference" option uses this sentinel and the form handler maps
 * it back to `null` before hitting the API.
 */
const NO_LANG = "__none__";

/**
 * Top-10 most-spoken languages, ISO 639-1. Labels show the native
 * script alongside the English name so the dropdown is recognisable
 * regardless of which UI language the viewer has on.
 */
const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: NO_LANG, label: "—" },
  { value: "en", label: "English" },
  { value: "zh", label: "中文 · Chinese" },
  { value: "es", label: "Español · Spanish" },
  { value: "hi", label: "हिन्दी · Hindi" },
  { value: "fr", label: "Français · French" },
  { value: "ar", label: "العربية · Arabic" },
  { value: "pt", label: "Português · Portuguese" },
  { value: "de", label: "Deutsch · German" },
  { value: "ja", label: "日本語 · Japanese" },
  { value: "ru", label: "Русский · Russian" },
];

const CampaignUpdate = (props: CampaignUpdateProps) => {
  const campaignApi = useClient<CampaignController>();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  const form = useForm({
    initialValues: {
      icon: props.campaign.icon,
      title: props.campaign.title,
      preferredLanguage: props.campaign.preferredLanguage ?? NO_LANG,
    },
    schema: z.object({
      icon: z.uuid().nullable().optional(),
      title: z
        .string()
        .min(3)
        .max(24)
        .meta({ title: tr("campaign.create.name") }),
      preferredLanguage: z.string().optional(),
    }),
    handler: async (values) => {
      const lang = values.preferredLanguage;
      const campaign = await campaignApi.updateCampaignById({
        params: { id: props.campaign.id },
        body: {
          title: values.title,
          // Force null so the server can distinguish "cleared" from "absent".
          icon: values.icon ?? null,
          preferredLanguage: lang && lang !== NO_LANG ? lang : null,
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
      groups={[{ fields: ["icon", "title", "preferredLanguage"] }]}
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
        preferredLanguage: {
          label: tr("campaign.update.preferredLanguage.label"),
          icon: Languages,
          select: true,
          items: LANGUAGE_OPTIONS,
          description: tr("campaign.update.preferredLanguage.helper"),
        },
      }}
    />
  );
};

export default CampaignUpdate;
