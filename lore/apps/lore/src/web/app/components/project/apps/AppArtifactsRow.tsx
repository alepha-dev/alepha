import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Cloud, GitCommitHorizontal, Server } from "lucide-react";
import type { ReactNode } from "react";

import type { ArtifactGroup } from "@/api/schemas/artifactGroupSchema.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface AppArtifactsRowProps {
  group: ArtifactGroup;
  /**
   * What the Deploy tab puts at the end of the row.
   *
   * ⚠️ A slot rather than a second table. Two artifact lists on one instance
   * page, disagreeing about column widths and about which digest is short
   * enough, is what reusing this row exists to avoid - so the Deploy tab
   * renders THIS row and hands it a button.
   */
  action?: (group: ArtifactGroup) => ReactNode;
}

/**
 * One tag, and every runtime built for it.
 *
 * ## What each column is for
 *
 * **Tag** is the identity, and the join key to a release of the same name.
 * **Variants** are the runtimes, as chips rather than rows - the whole reason
 * the endpoint groups. **Digest** is short, because a full sha256 is 64
 * characters of noise on a row and the whole value is on the title attribute
 * for anyone who needs to copy it. **Size** and **pushed** are how an operator
 * tells a real build from a broken one at a glance. **Commit** is present only
 * when CI sent one, which a laptop push never does.
 *
 * **There is no state column, and there should never be one.** A registry row
 * exists or it does not. Ready / building / failed chips would be modelling a
 * build pipeline, which is a different system that reports elsewhere.
 *
 * ## No download button
 *
 * There is no anonymous artifact surface and no signed URL in this epic: bytes
 * come back through an authenticated endpoint or not at all, and that endpoint
 * does not exist yet. A control that cannot do its job is worse than an absent
 * one, so it arrives with the endpoint rather than before it.
 */
const AppArtifactsRow = (props: AppArtifactsRowProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const { group } = props;

  const size = (bytes: number) =>
    `${l(bytes / 1_000_000, { number: { maximumFractionDigits: 1 } })} MB`;

  // One number for the tag, not one per variant.
  //
  // ⚠️ It used to be `Math.max(...variants.map(v => v.size))` with the reason
  // "a release's weight is what its heaviest build weighs, since only one of
  // them is ever deployed". Both halves stopped being true: a variant may
  // carry no size at all (an image's is best effort), which makes that
  // `Math.max` return `NaN` and the cell read `NaN MB`; and an image is never
  // the one deployed, so it is not what the sentence was about either.
  //
  // The heaviest of the variants that HAVE a size, and nothing at all when
  // none does.
  const sizes = group.variants
    .map((variant) => variant.size)
    .filter((it): it is number => it !== undefined);
  const heaviest = sizes.length ? Math.max(...sizes) : undefined;
  // Same reasoning for the digest: the row names the tag, and the tag's newest
  // variant is what `pushedAt` already describes.
  const [newest] = group.variants;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
      <span className="w-28 shrink-0 truncate font-medium" title={group.tag}>
        {group.tag}
      </span>

      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {group.variants.map((variant) => (
          <Badge key={variant.runtime} variant="tint" className="gap-1">
            {variant.runtime === "workerd" ? (
              <Cloud className="size-3 shrink-0" aria-hidden />
            ) : (
              <Server className="size-3 shrink-0" aria-hidden />
            )}
            {variant.runtime}
          </Badge>
        ))}
      </span>

      <span
        className="text-muted-foreground shrink-0 font-mono text-xs"
        title={newest.sha256}
      >
        {newest.sha256.slice(0, 12)}
      </span>

      <span
        className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
        title={
          heaviest === undefined ? undefined : tr("app.artifacts.size.hint")
        }
      >
        {heaviest === undefined ? "N/A" : size(heaviest)}
      </span>

      <span className="text-muted-foreground shrink-0 text-xs">
        {String(l(group.pushedAt, { date: "fromNow" }))}
      </span>

      {group.commitSha && (
        <span
          className="text-muted-foreground/70 flex shrink-0 items-center gap-1 font-mono text-xs"
          title={tr("app.artifacts.commit", { args: [group.commitSha] })}
        >
          <GitCommitHorizontal className="size-3.5 shrink-0" aria-hidden />
          {group.commitSha.slice(0, 7)}
        </span>
      )}

      {props.action ? (
        <span className="ml-auto shrink-0">{props.action(group)}</span>
      ) : null}
    </div>
  );
};

export default AppArtifactsRow;
