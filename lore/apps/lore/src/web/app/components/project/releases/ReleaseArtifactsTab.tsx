import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import { useI18n } from "alepha/react/i18n";
import { Archive, Cloud, Container, Link2, Server } from "lucide-react";
import { useMemo } from "react";

import type { ArtifactGroup } from "@/api/schemas/artifactGroupSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ArtifactPullCommand from "../../shared/ArtifactPullCommand.tsx";
import { artifactRuntimeLabel } from "../../shared/artifactRuntimeLabel.ts";

export interface ReleaseArtifactsTabProps {
  /**
   * The release's tag, which IS the join key. Named in the header and in the
   * empty state, because it is what a build has to be tagged with to appear
   * here.
   */
  tag: string;
  artifacts: ArtifactGroup[];
  loading?: boolean;
}

/**
 * Every artifact built against this release's tag.
 *
 * ⚠️ **This was fixture-backed until epic #18.** The tab was designed and built
 * before the registry existed, so it rendered `releaseArtifactsPreview` and
 * said "Preview" out loud in three places. Those are gone: the rows are real,
 * and the preview chip, the sample footnote and the fixture module went with
 * them.
 *
 * ## The join
 *
 * `artifacts.tag = releases.tag`. **No join table and no foreign key**: a
 * release named `0.28.0` and an artifact tagged `0.28.0` are the same fact
 * stated twice, and making it a foreign key would mean maintaining a link for
 * something the two rows already agree on. It would also break the direction
 * that matters - an artifact pushed by CI before anyone created the release
 * still belongs to it once the release appears.
 *
 * The consequence, and it is the point: **an artifact with no release and a
 * release with no artifact are both normal**, which is why the empty state
 * here is a sentence rather than a warning.
 *
 * ## Why one row per variant (#Q2267)
 *
 * The endpoint groups by `(app, tag)`, which is right on an app's page, where
 * the TAG is what varies and the variants are what a tag carries. Here the
 * tag is this release's on every row, so what varies is the app, the format
 * and the runtime, and each of those combinations is a separate thing that
 * shipped: its own bytes, its own digest, its own size, pushed at its own
 * time. Grouped by app, the row could show only one variant's digest and
 * size (the archive's, by rule) beside chips for the others, so two of the
 * three builds of a release had no digest on screen at all.
 *
 * So the groups are unwound: one row per `(app, format, runtime)`, ordered
 * by app, then format, then the stored runtime value, and every cell reads
 * from its own variant. The runtime prints as `artifactRuntimeLabel` has it
 * (`workerd` reads "cloudflare"), and the version is in the header rather
 * than repeated. **Digest** is short, with the whole value on the title: a
 * deploy pins a digest because a tag can be moved by whoever pushes next.
 *
 * An image row carries its registry reference in the one flexible column,
 * which is empty on a tarball: Lore records an image's reference and never
 * its bytes, so the reference IS that artifact. It sits before the digest so
 * the fixed columns line up down the table whichever rows carry one.
 *
 * **There is no state column, and there should never be one.** A registry row
 * exists or it does not. Ready / building / failed chips would be modelling a
 * build pipeline, which is a different system that reports elsewhere.
 *
 * No `Upload` button and no per-row `Download`. Uploading is `lore artifacts
 * push`, from CI, with a credential this page does not hold; there is
 * no authenticated download endpoint yet. A control that cannot do its job is
 * worse than an absent one.
 */
const ReleaseArtifactsTab = (props: ReleaseArtifactsTabProps) => {
  const { tr, l } = useI18n<I18n, "en">();

  const size = (bytes: number) =>
    `${l(bytes / 1_000_000, { number: { maximumFractionDigits: 1 } })} MB`;

  const variants = useMemo(
    () =>
      props.artifacts
        .flatMap((group) => group.variants)
        .sort(
          (a, b) =>
            a.app.localeCompare(b.app) ||
            a.format.localeCompare(b.format) ||
            a.runtime.localeCompare(b.runtime),
        ),
    [props.artifacts],
  );

  return (
    <div className="flex flex-col gap-4 px-6 pt-[22px] pb-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.09em] uppercase">
          {tr("release.artifacts.title")}
        </span>
        <span className="text-muted-foreground text-[11.5px]">
          {tr("release.artifacts.matchedOn")}{" "}
          <span className="font-mono">artifacts.tag = {props.tag}</span>
        </span>
      </div>

      {/*
        Loading is not empty. A tab that renders "nothing has been built" for
        the length of a round trip tells a reader something false, and it is
        the reading they are most likely to act on.
      */}
      {props.loading ? (
        <p className="text-muted-foreground text-[13px]">
          {tr("release.artifacts.loading")}
        </p>
      ) : variants.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          {tr("release.artifacts.empty", { args: [props.tag] })}
        </p>
      ) : (
        <div className="border-border overflow-hidden rounded-xl border">
          <div className="text-muted-foreground border-border flex items-center gap-4 border-b px-[15px] py-2.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
            <span className="w-40 shrink-0">
              {tr("release.artifacts.column.app")}
            </span>
            <span className="w-24 shrink-0">
              {tr("release.artifacts.column.format")}
            </span>
            <span className="w-28 shrink-0">
              {tr("release.artifacts.column.runtime")}
            </span>
            {/* The reference column has no heading: only an image fills it,
                and its cell says what it is. */}
            <span className="min-w-0 flex-1" aria-hidden />
            <span className="w-[130px] shrink-0">
              {tr("release.artifacts.column.digest")}
            </span>
            <span className="w-[78px] shrink-0 text-right">
              {tr("release.artifacts.column.size")}
            </span>
            <span className="w-30 shrink-0">
              {tr("release.artifacts.column.uploaded")}
            </span>
          </div>
          {variants.map((variant) => (
            <div
              key={variant.id}
              data-testid="release-artifact-row"
              className="border-border/60 flex items-center gap-4 border-b px-[15px] py-2.5 text-[12.5px] last:border-b-0"
            >
              <span className="w-40 shrink-0 truncate font-medium">
                {variant.app}
              </span>
              <span className="flex w-24 shrink-0 items-center gap-1.5 font-mono text-[12px]">
                {variant.format === "image" ? (
                  <Container className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <Archive className="size-3.5 shrink-0" aria-hidden />
                )}
                {variant.format}
              </span>
              <span className="flex w-28 shrink-0 items-center gap-1.5 font-mono text-[12px]">
                {variant.runtime === "workerd" ? (
                  <Cloud className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <Server className="size-3.5 shrink-0" aria-hidden />
                )}
                {artifactRuntimeLabel(variant.runtime)}
              </span>
              <span className="flex min-w-0 flex-1">
                {variant.format === "image" && variant.reference && (
                  <ArtifactPullCommand reference={variant.reference} />
                )}
              </span>
              <span
                className="text-muted-foreground w-[130px] shrink-0 truncate font-mono text-[11.5px]"
                title={variant.sha256}
              >
                {variant.sha256.slice(0, 12)}
              </span>
              {/* An image variant often carries no size: N/A, never NaN. */}
              <span className="w-[78px] shrink-0 text-right font-mono text-[11.5px] tabular-nums">
                {variant.size === undefined ? "N/A" : size(variant.size)}
              </span>
              {/* `updatedAt`, not `createdAt`: `latest` is replaced in place,
                  so "uploaded" means when these bytes arrived. */}
              <TimeAgo
                value={variant.updatedAt}
                className="text-muted-foreground w-30 shrink-0 truncate text-[11.5px]"
              />
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
