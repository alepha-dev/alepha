import { useI18n } from "alepha/react/i18n";
import { Cloud, Link2, Server } from "lucide-react";

import type { ArtifactGroup } from "@/api/schemas/artifactGroupSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

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
 * ## Why these columns
 *
 * **App** and **runtimes** are the two axes that vary; the version is this
 * release's tag on every row, so it is in the header rather than repeated.
 * **Digest** is short, with the whole value on the title: a deploy pins a
 * digest because a tag can be moved by whoever pushes next.
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
      ) : props.artifacts.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          {tr("release.artifacts.empty", { args: [props.tag] })}
        </p>
      ) : (
        <div className="border-border overflow-hidden rounded-xl border">
          <div className="text-muted-foreground border-border flex items-center gap-4 border-b px-[15px] py-2.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
            <span className="w-40 shrink-0">
              {tr("release.artifacts.column.app")}
            </span>
            <span className="min-w-0 flex-1">
              {tr("release.artifacts.column.target")}
            </span>
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
          {/*
            One row per app, since every row here already shares one tag. The
            runtimes sit inside it as chips: `(app, tag, runtime)` is the key
            precisely so two builds of one release are variants rather than two
            releases.
          */}
          {props.artifacts.map((group) => {
            const [newest] = group.variants;
            const heaviest = Math.max(
              ...group.variants.map((variant) => variant.size),
            );

            return (
              <div
                key={group.app}
                className="border-border/60 flex items-center gap-4 border-b px-[15px] py-2.5 text-[12.5px] last:border-b-0"
              >
                <span className="w-40 shrink-0 truncate font-medium">
                  {group.app}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {group.variants.map((variant) => (
                    <span
                      key={variant.runtime}
                      className="flex items-center gap-1.5 font-mono text-[12px]"
                    >
                      {variant.runtime === "workerd" ? (
                        <Cloud className="size-3.5 shrink-0" aria-hidden />
                      ) : (
                        <Server className="size-3.5 shrink-0" aria-hidden />
                      )}
                      {variant.runtime}
                    </span>
                  ))}
                </span>
                <span
                  className="text-muted-foreground w-[130px] shrink-0 truncate font-mono text-[11.5px]"
                  title={newest.sha256}
                >
                  {newest.sha256.slice(0, 12)}
                </span>
                <span className="w-[78px] shrink-0 text-right font-mono text-[11.5px] tabular-nums">
                  {size(heaviest)}
                </span>
                <span className="text-muted-foreground w-30 shrink-0 truncate text-[11.5px]">
                  {String(l(group.pushedAt, { date: "fromNow" }))}
                </span>
              </div>
            );
          })}
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
