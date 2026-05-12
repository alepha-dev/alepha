import { Button } from "@alepha/ui/components/ui/button";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { BookOpen, Plus } from "lucide-react";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";

const FoliosEmpty = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const campaignId = campaign ? String(campaign.id) : "";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="bg-muted text-muted-foreground inline-flex size-14 items-center justify-center rounded-full">
        <BookOpen className="size-6" />
      </div>
      <h2 className="text-xl font-semibold">{tr("folios.empty-title")}</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        {tr("folios.empty-subtitle")}
      </p>
      <Button asChild className="mt-2">
        <Link
          href={router.path("campaignFoliosNew", { params: { campaignId } })}
        >
          <Plus className="size-4" />
          {tr("folios.new")}
        </Link>
      </Button>
    </div>
  );
};

export default FoliosEmpty;
