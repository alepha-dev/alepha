import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { CryptoProvider } from "alepha/crypto";
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
import {
  ChevronRight,
  History,
  ListTree,
  Lock,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentFolioAtom } from "../../atoms/currentFolioAtom.ts";
import { folioTagsAtom } from "../../atoms/folioTagsAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { useWikiLinkRewrite } from "../shared/useWikiLinkRewrite.ts";
import FolioBacklinksPanel from "./FolioBacklinksPanel.tsx";
import FolioHistoryPanel from "./FolioHistoryPanel.tsx";
import FolioPassphraseDialog from "./FolioPassphraseDialog.tsx";
import FolioProtectedView from "./FolioProtectedView.tsx";
import FolioTreePanel from "./FolioTreePanel.tsx";
import {
  ensureProtectedKeysAutoLock,
  rememberProtectedKey,
} from "./protectedFolioKeys.ts";
import WikiLinkHoverProvider from "./WikiLinkHoverProvider.tsx";

const TREE_OPEN_KEY = "lor.folio.view.treeOpen";
const HISTORY_OPEN_KEY = "lor.folio.view.historyOpen";

const readBool = (key: string): boolean => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "1";
};

const FolioView = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const folioApi = useClient<FolioController>();
  const alepha = useAlepha();
  const crypto = useInject(CryptoProvider);
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [folio] = useStore(currentFolioAtom);
  const [folios, setFolios] = useStore(userFoliosAtom);
  const [, setTags] = useStore(folioTagsAtom);
  const [campaign] = useStore(currentCampaignAtom);
  const campaignId = campaign ? String(campaign.id) : "";

  // Resolve inline `[[#N]]` / `[[quest:#N]]` wiki-links to clickable links.
  // The hook also exposes the fetched lookups so the hover-preview
  // provider below can reuse them without a second round of fetches.
  const { content: rewrittenContent, blobs: wikiBlobs } = useWikiLinkRewrite(
    folio?.content ?? "",
    campaign?.id,
  );

  // Side-pane open state, persisted per browser. Defaults closed so the
  // first-time view stays focused on the markdown.
  const [treeOpen, setTreeOpen] = useState<boolean>(() =>
    readBool(TREE_OPEN_KEY),
  );
  const [historyOpen, setHistoryOpen] = useState<boolean>(() =>
    readBool(HISTORY_OPEN_KEY),
  );
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TREE_OPEN_KEY, treeOpen ? "1" : "0");
    }
  }, [treeOpen]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HISTORY_OPEN_KEY, historyOpen ? "1" : "0");
    }
  }, [historyOpen]);

  const pinAction = useAction(
    {
      handler: async () => {
        if (!folio) return;
        const next = !folio.pinned;
        const updated = await folioApi.update({
          params: { id: folio.id },
          body: { pinned: next },
        });
        // Mirror into the current folio + list atoms so the sidebar
        // re-sorts immediately without a refetch.
        alepha.store.set(currentFolioAtom, updated as typeof folio);
        setFolios(
          folios.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)),
        );
      },
    },
    [folio, folioApi, folios, alepha, setFolios],
  );

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

  // Folio-tree breadcrumb is gone since quest #66 — folios live in
  // archive directories now, and the Archive page handles the
  // directory-tree breadcrumb. Leaving the trail empty keeps the view
  // simple until that page lands in Phase F.
  const breadcrumb: typeof folios = [];

  const handleDelete = async () => {
    const confirmed = await dialog.confirm({
      title: tr("folios.confirm-delete-title"),
      description: tr("folios.confirm-delete-message"),
    });
    if (confirmed) await deleteAction.run();
  };

  // Encrypt a clear folio in place: derive a key from the new passphrase,
  // encrypt the current plaintext client-side, and persist the envelope.
  // The server clears searchText + outbound links on the clear→protected
  // transition. Caching the key leaves the folio immediately readable.
  const handleEncrypt = async (passphrase: string): Promise<string | null> => {
    if (!folio) return null;
    try {
      const saltHex = crypto.randomUUID().replace(/-/g, "");
      const key = await crypto.deriveKeyFromPassphrase(passphrase, saltHex);
      const envelope = await crypto.encryptWithPassphrase(
        folio.content,
        key,
        saltHex,
      );
      const updated = await folioApi.update({
        params: { id: folio.id },
        body: { protected: true, content: envelope },
      });
      rememberProtectedKey(updated.id, key);
      ensureProtectedKeysAutoLock();
      alepha.store.set(currentFolioAtom, updated as typeof folio);
      setFolios(
        folios.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)),
      );
      return null;
    } catch {
      return tr("folios.protected.encrypt-failed");
    }
  };

  return (
    <div className="relative h-full overflow-hidden">
      {/* Toggle buttons — absolute inside this wrapper (which sits in
          the FoliosLayout main column, so they're already to the right
          of the AppShell sidebar). They don't move as the article
          scrolls because the article scrolls in its own nested
          container below. */}
      <div className="pointer-events-none absolute left-0 right-0 top-2 z-30 flex justify-between px-2">
        <Button
          variant={treeOpen ? "secondary" : "ghost"}
          size="sm"
          className="pointer-events-auto h-8 w-8 p-0"
          onClick={() => setTreeOpen((v) => !v)}
          aria-label={String(
            tr(treeOpen ? "folios.tree.close" : "folios.tree.open"),
          )}
          aria-pressed={treeOpen}
        >
          <ListTree className="size-4" />
        </Button>
        <Button
          variant={historyOpen ? "secondary" : "ghost"}
          size="sm"
          className="pointer-events-auto h-8 w-8 p-0"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-label={String(
            tr(historyOpen ? "folios.history.close" : "folios.history.open"),
          )}
          aria-pressed={historyOpen}
        >
          <History className="size-4" />
        </Button>
      </div>

      {/* Left pane — folio tree. Absolute inside the wrapper so it's
          horizontally bounded to the content column (doesn't cover the
          AppShell sidebar) and vertically pinned (doesn't scroll with
          the article — that scrolling happens in the inner div below).
          `group` so the close button only appears on pane hover. */}
      {treeOpen && (
        <aside className="border-border bg-card/95 absolute bottom-0 left-0 top-0 z-20 w-72 overflow-y-auto border-r shadow-lg backdrop-blur">
          <div className={"pt-12"} />
          <FolioTreePanel
            campaignId={campaign?.id ?? 0}
            campaignIdStr={campaignId}
            currentFolioId={folio.id}
          />
        </aside>
      )}

      {/* Right pane — folio history (same width, opposite edge). */}
      {historyOpen && (
        <aside className="border-border bg-card/95 absolute bottom-0 right-0 top-0 z-20 w-72 overflow-y-auto border-l shadow-lg backdrop-blur">
          <div className={"pt-12"} />
          <div className="px-3 pb-3">
            <FolioHistoryPanel
              folio={folio}
              onReverted={(updated) => {
                alepha.store.set(currentFolioAtom, updated);
                setFolios(
                  folios.map((f) =>
                    f.id === updated.id ? { ...f, ...updated } : f,
                  ),
                );
              }}
            />
          </div>
        </aside>
      )}

      <div className="h-full overflow-auto">
        <article className="mx-auto flex max-w-3xl flex-col gap-4 p-8 pt-12">
          {breadcrumb.length > 0 && (
            <nav
              aria-label="Folio breadcrumb"
              className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs"
            >
              {breadcrumb.map((ancestor, i) => (
                <span key={ancestor.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3 opacity-60" />}
                  <Link
                    href={router.path("campaignFoliosFolio", {
                      params: {
                        campaignId,
                        shortId: ancestor.shortId,
                      },
                    })}
                    className="hover:text-foreground hover:underline"
                  >
                    {ancestor.title}
                  </Link>
                </span>
              ))}
              <ChevronRight className="size-3 opacity-60" />
              <span className="text-foreground/80">{folio.title}</span>
            </nav>
          )}
          <div className="flex items-start gap-2">
            <h1 className="flex-1 text-3xl font-bold tracking-tight">
              {folio.title}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => pinAction.run()}
              disabled={pinAction.loading}
              aria-label={String(
                tr(folio.pinned ? "folios.unpin" : "folios.pin"),
              )}
              aria-pressed={folio.pinned}
              className={folio.pinned ? "text-primary" : undefined}
            >
              {folio.pinned ? (
                <PinOff className="size-4" />
              ) : (
                <Pin className="size-4" />
              )}
            </Button>
            {!folio.protected && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEncryptOpen(true)}
                aria-label={tr("folios.protected.encrypt")}
              >
                <Lock className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              render={
                <Link
                  href={router.path("campaignFoliosFolioEdit", {
                    params: { campaignId, shortId: folio.shortId },
                  })}
                  aria-label={tr("folios.edit")}
                />
              }
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              disabled={deleteAction.loading}
              aria-label={tr("folios.delete")}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span>
              {tr("folios.updated", {
                args: [dt.of(folio.updatedAt).fromNow()],
              })}
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
            {folio.protected ? (
              <FolioProtectedView
                folio={folio}
                onDeleteUnrecoverable={handleDelete}
              />
            ) : folio.content && campaign ? (
              <WikiLinkHoverProvider campaignId={campaign.id} blobs={wikiBlobs}>
                <MarkdownView content={rewrittenContent} />
              </WikiLinkHoverProvider>
            ) : (
              <p className="text-muted-foreground text-sm italic">
                {tr("folios.empty-folio")}
              </p>
            )}
          </div>

          <FolioBacklinksPanel
            links={folio.metadata?.links}
            campaignId={campaignId}
          />
        </article>
      </div>

      <FolioPassphraseDialog
        open={encryptOpen}
        onOpenChange={setEncryptOpen}
        title={tr("folios.protected.encrypt-title")}
        description={tr("folios.protected.encrypt-description")}
        submitLabel={tr("folios.protected.encrypt")}
        requireConfirm
        onSubmit={handleEncrypt}
      />
    </div>
  );
};

export default FolioView;
