import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Cloud, GitCommitHorizontal, Server } from "lucide-react";

import type { ArtifactGroup } from "@/api/schemas/artifactGroupSchema.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface AppArtifactsRowProps {
  group: ArtifactGroup;
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

  // One number for the tag, not one per variant: a release's weight is what
  // its heaviest build weighs, since only one of them is ever deployed.
  const heaviest = Math.max(...group.variants.map((variant) => variant.size));
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

      <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
        {size(heaviest)}
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
    </div>
  );
};

export default AppArtifactsRow;
