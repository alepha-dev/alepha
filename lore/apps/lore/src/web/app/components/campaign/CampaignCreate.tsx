import { Control } from "@alepha/ui/components/control/control";
import { ControlUpload } from "@alepha/ui/components/control-upload/control-upload";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { t } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Hammer, Sparkles, Tag } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

const CampaignCreate = () => {
  const client = useClient<CampaignController>();
  const router = useRouter<AppRouter>();
  const auth = useAuth();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  const initialValues = useMemo(() => {
    try {
      if (router.query.b) {
        return JSON.parse(decodeURIComponent(router.query.b));
      }
    } catch {
      // ignore
    }
  }, [router.query.b]);

  const form = useForm({
    initialValues,
    schema: t.object({
      title: t.string({
        minLength: 3,
        maxLength: 24,
      }),
      public: t.optional(t.boolean()),
      icon: t.optional(t.uuid()),
    }),
    onError: (error) => {
      toast.error(error.message);
    },
    handler: async (body) => {
      if (!auth.user) {
        await router.push("login", {
          query: {
            r: router.path("campaignCreate", {
              query: {
                b: encodeURIComponent(JSON.stringify(body)),
              },
            }),
          },
        });
        return;
      }

      const campaign = await client.createCampaign({ body });

      await router.push("campaign", {
        params: { campaignId: String(campaign.id) },
      });

      alepha.store.set(userCampaignsAtom, [
        ...(alepha.store.get(userCampaignsAtom) || []),
        campaign,
      ]);
    },
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12 md:pt-24">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="text-muted-foreground inline-flex items-center gap-2 text-xs uppercase tracking-widest">
            <Sparkles className="size-4" />
            {tr("home.create-campaign")}
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            {tr("campaign.create.title")}
          </h1>
          <p className="text-muted-foreground max-w-xl text-base">
            {tr("campaign.create.description")}
          </p>
        </div>

        <Card className="shadow-sm">
          <CardContent className="flex flex-col gap-6">
            <form {...form.props} className="flex flex-col gap-6">
              <ControlUpload
                input={form.input.icon}
                label="Icon"
                accept="image/*"
                maxSize={2 * 1024 * 1024}
                bucket="campaign-icons"
                disabled={form.submitting}
              />
              <Control
                input={form.input.title}
                icon={Tag}
                label={String(tr("campaign.create.name"))}
                description={String(tr("campaign.create.name.helper"))}
              />
              <Control
                input={form.input.public}
                label={String(tr("campaign.create.public"))}
                description={String(tr("campaign.create.public.helper"))}
              />
              <div className="flex gap-3">
                <Button
                  type="submit"
                  size="lg"
                  disabled={form.submitting}
                  className="h-12 px-8 text-base"
                >
                  <Hammer className="size-5" />
                  {tr("campaign.create.submit")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CampaignCreate;
