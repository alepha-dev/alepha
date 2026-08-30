import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Flag, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleaseListRow from "./ReleaseListRow.tsx";

/**
 * Every release in the project, in two groups: **Open**, then **Released**.
 *
 * Not tabs and not three groups. There is no "active" state because nothing
 * pauses, and the whole point is seeing `0.28.0`, `1.0.0` and `1.1.0` at once
 * — which the page this replaced could not do at all: it was built around one
 * open milestone and a ledger of closed ones, because the model allowed
 * exactly one open at a time.
 *
 * ⚠️ Ordered by `number`, **never by `tag`**. Semver does not sort as text:
 * `0.10.0` comes before `0.9.0`. Same bug class as the text-enum priority
 * ordering that put `optional` above `high` on the board for a year.
 */
const ProjectReleases = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [releases, setReleases] = useStore(currentReleasesAtom);
  const releaseApi = useClient<ReleaseController>();

  const [creating, setCreating] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const byNumber = useMemo(
    () => [...(releases ?? [])].sort((a, b) => a.number - b.number),
    [releases],
  );
  const open = byNumber.filter((release) => !release.releasedAt);
  const released = byNumber.filter((release) => release.releasedAt);

  const reload = useCallback(async () => {
    if (!project) return;
    setReleases(
      await releaseApi.getReleases({ params: { projectId: project.id } }),
    );
  }, [project?.id]);

  const create = async () => {
    if (!project) return;
    const tag = newTag.trim();
    if (!tag || submitting) return;
    setSubmitting(true);
    try {
      // One field. `title` is NOT NULL at the column and defaults to the tag
      // server-side, so a release called only `0.28.0` reads as `0.28.0` and
      // the form never has to ask.
      await releaseApi.createRelease({
        params: { projectId: project.id },
        body: { tag },
      });
      setNewTag("");
      setCreating(false);
      await reload();
    } catch (error) {
      // The row stays open so the typed tag is not lost: the usual failure
      // here is a tag already taken or a shape the URL cannot carry, and both
      // are fixed by editing what is already there.
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!project) return null;

  const openDetail = (tag: string) =>
    router.push("projectRelease", { params: { releaseTag: tag } });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6 lg:px-7">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-lg font-semibold">
          {tr("project.menu.releases")}
        </h1>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {tr("release.start")}
          </Button>
        )}
      </div>

      {/* An inline row rather than the modal the old flow used, which opened
          with a server round-trip to a fantasy-name generator. */}
      {creating && (
        <div className="border-border flex items-center gap-2 rounded-lg border p-3">
          <Input
            value={newTag}
            className="font-mono"
            placeholder={tr("release.start.tag.placeholder")}
            onChange={(e) => setNewTag(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
              if (e.key === "Escape") setCreating(false);
            }}
            // Autofocus on the field the row exists to fill, on open only.
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <Button onClick={() => void create()} disabled={submitting}>
            {tr("release.create.confirm")}
          </Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            {tr("common.cancel")}
          </Button>
        </div>
      )}

      {byNumber.length === 0 && !creating ? (
        <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
          <Flag className="text-muted-foreground size-7" />
          <h2 className="text-[15px] font-semibold">
            {tr("release.empty.title")}
          </h2>
          <p className="text-muted-foreground max-w-md text-[13px] text-pretty">
            {tr("release.empty.body")}
          </p>
          <Button className="mt-1" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {tr("release.start")}
          </Button>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-[11px] font-semibold tracking-[0.1em] uppercase">
                {tr("release.group.open")}
              </h2>
              {open.map((release) => (
                <ReleaseListRow
                  key={release.id}
                  release={release}
                  onOpen={openDetail}
                />
              ))}
            </section>
          )}

          {released.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-[11px] font-semibold tracking-[0.1em] uppercase">
                {tr("release.group.released")}
              </h2>
              {released.map((release) => (
                <ReleaseListRow
                  key={release.id}
                  release={release}
                  onOpen={openDetail}
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default ProjectReleases;
