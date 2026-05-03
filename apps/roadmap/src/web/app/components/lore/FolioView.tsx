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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { AppRouter } from "../../AppRouter.ts";
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
        await router.push(router.path("lore"));
      },
    },
    [folio, folios, folioApi, alepha, router, setFolios, setTags],
  );

  if (!folio) return null;

  const handleDelete = async () => {
    const confirmed = await dialog.confirm({
      title: String(tr("lore.confirm-delete-title")),
      description: String(tr("lore.confirm-delete-message")),
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
            href={router.path("loreFolioEdit", { params: { id: folio.id } })}
            aria-label={String(tr("lore.edit"))}
          >
            <Pencil className="size-4" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          disabled={deleteAction.loading}
          aria-label={String(tr("lore.delete"))}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span>
          {tr("lore.updated", { args: [dt.of(folio.updatedAt).fromNow()] })}
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

      <div className="mt-4 max-w-none text-sm leading-relaxed">
        {folio.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="mt-6 mb-3 text-2xl font-semibold tracking-tight">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mt-6 mb-2 text-xl font-semibold tracking-tight">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="mt-4 mb-2 text-base font-semibold">
                  {children}
                </h3>
              ),
              p: ({ children }) => <p className="my-3">{children}</p>,
              ul: ({ children }) => (
                <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>
              ),
              li: ({ children }) => <li className="pl-1">{children}</li>,
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {children}
                </a>
              ),
              code: ({ children, className }) => {
                const isBlock = className?.startsWith("language-");
                if (isBlock) {
                  return (
                    <code className={`${className} text-xs`}>{children}</code>
                  );
                }
                return (
                  <code className="bg-muted rounded px-1.5 py-0.5 text-[0.85em] font-mono">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="bg-muted my-4 overflow-auto rounded-md p-3 text-xs">
                  {children}
                </pre>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-muted-foreground/30 my-3 border-l-2 pl-4 italic">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="border-border my-6" />,
              table: ({ children }) => (
                <table className="my-4 border-collapse text-xs">
                  {children}
                </table>
              ),
              th: ({ children }) => (
                <th className="border-border border px-2 py-1 text-left font-medium">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border-border border px-2 py-1">{children}</td>
              ),
            }}
          >
            {folio.content}
          </ReactMarkdown>
        ) : (
          <p className="text-muted-foreground italic">
            {tr("lore.empty-folio")}
          </p>
        )}
      </div>
    </article>
  );
};

export default FolioView;
