import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";

import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { ReleaseChangelogGroup } from "@/api/schemas/releaseChangelogGroupSchema.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleaseChangelogPanel from "./ReleaseChangelogPanel.tsx";
import ReleaseContents from "./ReleaseContents.tsx";
import ReleaseDetailHero from "./ReleaseDetailHero.tsx";
import ReleaseEditForm from "./ReleaseEditForm.tsx";
import ReleaseSaveToFolioDialog from "./ReleaseSaveToFolioDialog.tsx";

export interface ProjectReleaseProps {
  /**
   * The tag from the URL. The route param is `releaseTag`, never `tag` and
   * never `number` — one param name per tree position, see `AppRouter`.
   */
  releaseTag: string;
}

interface ChangelogState {
  markdown: string;
  groups: ReleaseChangelogGroup[];
  stats: { questCount: number; areaCount: number; contributorCount: number };
}

/**
 * One release: what is in it, and how far along it is.
 *
 * Resolved from `currentReleasesAtom` rather than fetched by tag: the project
 * loader already holds every release with its rollup, so the page opens
 * without a round-trip and the list it was clicked from cannot disagree with
 * it.
 */
const ProjectRelease = (props: ProjectReleaseProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const [releases, setReleases] = useStore(currentReleasesAtom);
  const releaseApi = useClient<ReleaseController>();
  const folioApi = useClient<FolioController>();

  const [changelog, setChangelog] = useState<ChangelogState | null>(null);
  const [changelogLoading, setChangelogLoading] = useState(true);
  const [changelogError, setChangelogError] = useState(false);
  const [folioOpen, setFolioOpen] = useState(false);
  const [folioSaving, setFolioSaving] = useState(false);

  const release: ReleaseResource | undefined = releases?.find(
    (r) => r.tag === props.releaseTag,
  );

  const reload = useCallback(async () => {
    if (!project) return;
    setReleases(
      await releaseApi.getReleases({ params: { projectId: project.id } }),
    );
  }, [project?.id]);

  useEffect(() => {
    if (!release) return;
    let cancelled = false;
    // Synchronous state at the top of a fetch effect: the panel has to read
    // as loading from the moment the release changes, not from whenever the
    // request resolves. Same shape the page this replaced used.
    // oxlint-disable-next-line react/set-state-in-effect
    setChangelogLoading(true);
    setChangelogError(false);
    releaseApi
      .getReleaseChangelog({ params: { id: release.id } })
      .then((res) => {
        if (cancelled) return;
        setChangelog({
          markdown: res.markdown,
          groups: res.groups,
          stats: res.stats,
        });
      })
      .catch(() => {
        if (!cancelled) setChangelogError(true);
      })
      .finally(() => {
        if (!cancelled) setChangelogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [release?.id, release?.releasedAt]);

  const handleCopy = async () => {
    if (!changelog) return;
    try {
      await navigator.clipboard.writeText(changelog.markdown);
      toaster.success(tr("release.changelog.copied"));
    } catch {
      toaster.error(tr("release.changelog.copyError"));
    }
  };

  const handleDownload = () => {
    if (!changelog || !release) return;
    const blob = new Blob([changelog.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `release-${release.tag ?? release.number}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToFolio = async (title: string) => {
    if (!project || !changelog || !release) return;
    setFolioSaving(true);
    try {
      await folioApi.create({
        body: {
          projectId: project.id,
          title,
          content: changelog.markdown,
          summary: tr("release.folio.summary", {
            args: [
              release.tag ?? String(release.number),
              String(changelog.stats.questCount),
            ],
          }) as string,
        },
      });
      setFolioOpen(false);
      toaster.success(tr("release.folio.saved"));
    } catch {
      // Dialog stays open so the typed title is not lost.
      toaster.error(tr("release.folio.error"));
    } finally {
      setFolioSaving(false);
    }
  };

  if (!project) return null;

  // A tag that resolves to nothing: a stale link, or a release deleted since.
  // Says so rather than rendering an empty hero.
  if (!release) {
    return (
      <div className="mx-auto w-full max-w-4xl px-5 py-12 text-center lg:px-7">
        <p className="text-muted-foreground text-sm">
          {tr("release.detail.notFound", { args: [props.releaseTag] })}
        </p>
      </div>
    );
  }

  const published = !!release.releasedAt;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6 lg:px-7">
      <ReleaseDetailHero release={release} onChanged={reload} />

      <ReleaseContents
        releaseId={release.id}
        readOnly={published}
        onChanged={() => void reload()}
      />

      {/* Editing is offered only while the release is open. A published one
          reads as a record: the server refuses the write anyway, and an
          affordance that always fails is worse than no affordance. */}
      {!published && (
        <div className="border-border rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Badge variant="secondary">{tr("release.detail.edit")}</Badge>
          </div>
          <ReleaseEditForm release={release} onUpdated={() => void reload()} />
        </div>
      )}

      <div className="border-border flex min-h-100 flex-col overflow-hidden rounded-lg border">
        <ReleaseChangelogPanel
          groups={changelog?.groups ?? []}
          statusLabel={String(
            published
              ? tr("release.changelog.frozen", {
                  args: [
                    release.tag ?? String(release.number),
                    String(changelog?.stats.questCount ?? 0),
                  ],
                })
              : tr("release.changelog.live", {
                  args: [String(changelog?.stats.questCount ?? 0)],
                }),
          )}
          live={!published}
          loading={changelogLoading}
          error={changelogError}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onSaveToFolio={() => setFolioOpen(true)}
        />
      </div>

      {/* `ReleaseSaveToFolioDialog` is the dialog's BODY, not a dialog: it
          has always been mounted inside one by its caller. */}
      <Dialog open={folioOpen} onOpenChange={(o) => !o && setFolioOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("release.folio.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <ReleaseSaveToFolioDialog
            defaultTitle={tr("release.folio.defaultTitle", {
              args: [release.tag ?? String(release.number), release.title],
            })}
            saving={folioSaving}
            onConfirm={handleSaveToFolio}
            onCancel={() => setFolioOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProjectRelease;
