import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Cloud, Link2, Server } from "lucide-react";

import type { I18n } from "@/web/app/services/I18n.ts";

import type { ReleaseArtifact } from "./releaseArtifactsPreview.ts";

export interface ReleaseArtifactsTabProps {
  /**
   * The release's tag, which IS the join key. Named in the header and in the
   * empty state, because it is what a build has to be tagged with to appear
   * here.
   */
  tag: string;
  artifacts: ReleaseArtifact[];
}

/**
 * Every artifact built against this release's tag.
 *
 * ⚠️ **Sample data. There is no artifact registry yet** - see
 * `releaseArtifactsPreview.ts`. The tab says so in its header and again under
 * the table, because a table of filenames and digests is otherwise
 * indistinguishable from a real one, and Lore deploys to production on every
 * push.
 *
 * ## Why these columns
 *
 * A filename is `{app}_{version}_{target}.tar.gz` and the version is always
 * this release's tag, so **app** and **target** are the only two axes that
 * vary and both get a column. **File** carries the whole name anyway rather
 * than leaving the reader to reassemble it: that string is what gets pasted
 * into a deploy command or grepped for in a bucket.
 *
 * **There is no state column, and there should never be one.** A registry row
 * exists or it does not. Ready / building / failed chips would be modelling a
 * build pipeline, which is a different system that reports elsewhere.
 *
 * ## What is missing on purpose
 *
 * No `Upload` button and no per-row `Download`. Both need an endpoint, and a
 * control that cannot do its job is worse than an absent one - the same
 * reason the plate has no overflow menu. They come back with the registry.
 */
const ReleaseArtifactsTab = (props: ReleaseArtifactsTabProps) => {
  const { tr, l } = useI18n<I18n, "en">();

  const size = (bytes: number) =>
    `${l(bytes / 1_000_000, { number: { maximumFractionDigits: 1 } })} MB`;

  return (
    <div className="flex flex-col gap-4 px-6 pt-[22px] pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.09em] uppercase">
          {tr("release.artifacts.title")}
        </span>
        <Badge variant="tint" tone="warning">
          {tr("release.artifacts.previewChip")}
        </Badge>
        <span className="text-muted-foreground text-[11.5px]">
          {tr("release.artifacts.matchedOn")}{" "}
          <span className="font-mono">artifacts.tag = {props.tag}</span>
        </span>
      </div>

      {props.artifacts.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          {tr("release.artifacts.empty", { args: [props.tag] })}
        </p>
      ) : (
        <div className="border-border overflow-hidden rounded-xl border">
          <div className="text-muted-foreground border-border flex items-center gap-4 border-b px-[15px] py-2.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
            <span className="w-33 shrink-0">
              {tr("release.artifacts.column.app")}
            </span>
            <span className="w-33 shrink-0">
              {tr("release.artifacts.column.target")}
            </span>
            <span className="min-w-0 flex-1">
              {tr("release.artifacts.column.file")}
            </span>
            <span className="w-[150px] shrink-0">
              {tr("release.artifacts.column.digest")}
            </span>
            <span className="w-[78px] shrink-0 text-right">
              {tr("release.artifacts.column.size")}
            </span>
            <span className="w-30 shrink-0">
              {tr("release.artifacts.column.uploaded")}
            </span>
          </div>
          {/* Read in app order, so an app's targets sit together. */}
          {props.artifacts.map((artifact) => (
            <div
              key={artifact.file}
              className="border-border/60 flex items-center gap-4 border-b px-[15px] py-2.5 text-[12.5px] last:border-b-0"
            >
              <span className="w-33 shrink-0 truncate font-medium">
                {artifact.app}
              </span>
              <span className="flex w-33 shrink-0 items-center gap-1.5 font-mono text-[12px]">
                {artifact.target === "node" ? (
                  <Server className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <Cloud className="size-3.5 shrink-0" aria-hidden />
                )}
                {artifact.target}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {artifact.file}
              </span>
              <span className="text-muted-foreground w-[150px] shrink-0 truncate font-mono text-[11.5px]">
                {artifact.digest}
              </span>
              <span className="w-[78px] shrink-0 text-right font-mono text-[11.5px] tabular-nums">
                {size(artifact.bytes)}
              </span>
              <span className="text-muted-foreground w-30 shrink-0 truncate text-[11.5px]">
                {l(artifact.uploadedAt, { date: "fromNow" })}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-muted/60 text-muted-foreground flex items-start gap-2.5 rounded-[10px] px-[14px] py-3 text-[11.5px] leading-[1.55]">
        <Link2 className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{tr("release.artifacts.joinNote")}</span>
      </div>
    </div>
  );
};

export default ReleaseArtifactsTab;
