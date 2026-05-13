import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import {
  useAction,
  useAlepha,
  useClient,
  useInject,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Pencil, Trash2 } from "lucide-react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentFolioAtom } from "../../atoms/currentFolioAtom.ts";
import { folioTagsAtom } from "../../atoms/folioTagsAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../services/I18n.ts";

const FolioView = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const folioApi = useClient<FolioController>();
  const alepha = useAlepha();
  const [folio] = useStore(currentFolioAtom);
  const [folios, setFolios] = useStore(userFoliosAtom);
  const [, setTags] = useStore(folioTagsAtom);
  const [campaign] = useStore(currentCampaignAtom);
  const campaignId = campaign ? String(campaign.id) : "";

  const deleteAction = useAction(
    {
      handler: async () => {
        if (!folio) return;
        await folioApi.delete({ params: { id: folio.id } });
        const remaining = folios.filter((f) => f.id !== folio.id);
        setFolios(remaining);
        const remainingTags = new Set<string>();
        for (const f of remaining) for (const t of f.tags) remainingTags.add(t);
        setTags([...remainingTags].sort());
        alepha.store.set(currentFolioAtom, undefined);
        await router.push(
          router.path("campaignFolios", { params: { campaignId } }),
        );
      },
    },
    [folio, folios, folioApi, alepha, router, setFolios, setTags],
  );

  if (!folio) return null;

  const handleDelete = async () => {
    const confirmed = await dialog.confirm({
      title: String(tr("folios.confirm-delete-title")),
      description: String(tr("folios.confirm-delete-message")),
    });
    if (confirmed) await deleteAction.run();
  };

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <div className="flex items-start gap-2">
        <h1 className="flex-1 text-3xl font-bold tracking-tight">
          {folio.title}
        </h1>
        <Button asChild variant="ghost" size="icon">
          <Link
            href={router.path("campaignFoliosFolioEdit", {
              params: { campaignId, id: folio.id },
            })}
            aria-label={String(tr("folios.edit"))}
          >
            <Pencil className="size-4" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          disabled={deleteAction.loading}
          aria-label={String(tr("folios.delete"))}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span>
          {tr("folios.updated", { args: [dt.of(folio.updatedAt).fromNow()] })}
        </span>
        {folio.tags.length > 0 && (
          <>
            <span>·</span>
            <div className="flex flex-wrap gap-1">
              {folio.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-4">
        {folio.content ? (
          <MarkdownView content={folio.content} />
        ) : (
          <p className="text-muted-foreground text-sm italic">
            {tr("folios.empty-folio")}
          </p>
        )}
      </div>
    </article>
  );
};

export default FolioView;
