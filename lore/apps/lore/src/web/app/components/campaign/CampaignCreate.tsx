import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { t } from "alepha";
import { useAlepha, useClient } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Hammer, Tag } from "lucide-react";
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
    <div className="mx-auto w-full max-w-3xl p-4">
      <form {...form.props}>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <span className="text-lg font-bold">
              {tr("campaign.create.title")}
            </span>
            <span className="text-muted-foreground text-sm">
              {tr("campaign.create.description")}
            </span>
          </div>
          <Card className="shadow">
            <CardContent className="flex max-w-xl flex-col gap-6 p-4">
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
                  disabled={form.submitting}
                  className="bg-green-600 text-white hover:bg-green-700"
                >
                  <Hammer className="size-4" />
                  {tr("campaign.create.submit")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
};

export default CampaignCreate;
