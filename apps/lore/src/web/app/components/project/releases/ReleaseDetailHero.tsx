import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { RotateCcw, Send } from "lucide-react";
import { useState } from "react";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseDetailHeroProps {
  release: ReleaseResource;
  onChanged: () => void;
}

/**
 * The release's identity and its one number: tag, title, work done against
 * work attached, and the date it is aimed at or the date it went out.
 *
 * Publishing is behind a confirmation because it is one-way, and the
 * confirmation says what freezes rather than just asking twice. Reopening is
 * worded as the exceptional thing it is - "published by mistake" - and is not
 * a toggle sitting beside Publish.
 */
const ReleaseDetailHero = (props: ReleaseDetailHeroProps) => {
  const { release } = props;
  const { tr, l } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const releaseApi = useClient<ReleaseController>();
  const [submitting, setSubmitting] = useState(false);

  const published = !!release.releasedAt;
  const { completed, total } = release.progress;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const publish = async () => {
    const ok = await dialog.confirm({
      title: String(tr("release.publish.title")),
      description: String(
        tr("release.publish.description", {
          args: [release.tag ?? String(release.number)],
        }),
      ),
      confirmLabel: String(tr("release.publish.confirm")),
      cancelLabel: String(tr("common.cancel")),
      destructive: true,
    });
    if (!ok || submitting) return;
    setSubmitting(true);
    try {
      await releaseApi.publishRelease({
        params: { id: release.id },
        body: {},
      });
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const reopen = async () => {
    const ok = await dialog.confirm({
      title: String(tr("release.reopen.title")),
      description: String(tr("release.reopen.description")),
      confirmLabel: String(tr("release.reopen.confirm")),
      cancelLabel: String(tr("common.cancel")),
      destructive: true,
    });
    if (!ok || submitting) return;
    setSubmitting(true);
    try {
      await releaseApi.reopenRelease({ params: { id: release.id } });
      props.onChanged();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-card border-border flex flex-col gap-5 rounded-lg border p-5 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge
            variant={published ? "outline" : "default"}
            className="font-mono"
          >
            {release.tag ?? `#${release.number}`}
          </Badge>
          <Badge variant="tint" tone={published ? "neutral" : "success"}>
            {published
              ? tr("release.status.closed")
              : tr("release.status.active")}
          </Badge>
        </div>
        {/* Printed only when it says something the tag does not: `title`
            defaults to the tag server-side. */}
        {release.title !== release.tag && (
          <h1 className="mt-2 truncate text-[22px] font-semibold tracking-[-0.015em]">
            {release.title}
          </h1>
        )}
        <p className="text-muted-foreground mt-1 text-[12.5px]">
          {published
            ? tr("release.list.releasedOn", {
                args: [String(l(release.releasedAt as string, { date: "ll" }))],
              })
            : release.targetDate
              ? tr("release.list.target", {
                  args: [
                    String(l(release.targetDate as string, { date: "ll" })),
                  ],
                })
              : tr("release.list.noTarget")}
        </p>
      </div>

      <div className="shrink-0 md:w-56">
        <div className="text-muted-foreground flex justify-between text-[10.5px] tracking-[0.1em] uppercase">
          <span>{tr("release.hero.progress")}</span>
          <span className="font-mono">
            {completed}/{total}
          </span>
        </div>
        <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full bg-green-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {release.progress.shelved > 0 && (
          <div className="text-muted-foreground mt-1.5 text-[11.5px]">
            {tr("release.hero.shelved", {
              args: [String(release.progress.shelved)],
            })}
          </div>
        )}
      </div>

      <div className="shrink-0">
        {published ? (
          // Not a toggle beside Publish: reopening is what you do when you
          // published by mistake, and it clears the frozen record.
          <Button
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() => void reopen()}
          >
            <RotateCcw className="size-3.5" />
            {tr("release.reopen.action")}
          </Button>
        ) : (
          <Button disabled={submitting} onClick={() => void publish()}>
            <Send className="size-4" />
            {tr("release.publish.action")}
          </Button>
        )}
      </div>
    </div>
  );
};

export default ReleaseDetailHero;
