import * as React from "react";

void React;

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alepha/ui/components/ui/avatar";
import { Button } from "@alepha/ui/components/ui/button";
import { UserAvatar } from "@alepha/ui/components/user-avatar/user-avatar";
import { useI18n } from "alepha/react/i18n";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface DetailAsideRow {
  /**
   * Doubles as the React key, so two rows in one aside must not share a label.
   */
  label: string;
  value?: React.ReactNode;
  /**
   * Renders a copy-to-clipboard button beside the value. When `value` is
   * omitted the row renders this text as the value, in mono — the shape an id
   * row wants.
   */
  copy?: string;
}

export interface DetailAsideProps {
  /**
   * Omit when something else on screen already names the thing — a
   * breadcrumb leaf, most often. With no title and no avatar the header
   * block is not rendered at all and the list starts at the top edge.
   */
  title?: string;
  /**
   * Thumbnail or avatar source, as a URL. Falls back to {@link fallback}.
   */
  image?: string;
  /**
   * The same picture as a file id served by `alepha/api/files` - a
   * `user.picture`, say - drawn through {@link UserAvatar} on the
   * authenticated file route. Wins over {@link image}.
   *
   * A separate prop because a file id is not a URL: handed to `image`, the
   * browser requested the bare id relative to the page and the fallback
   * letter was all anyone saw (#Q2246).
   */
  imageFileId?: string;
  /**
   * Shown in place of a missing image. Defaults to the title's initial.
   */
  fallback?: string;
  /**
   * Set `false` for an entity that has no avatar concept at all, and the
   * title stands alone.
   *
   * The letter fallback earns its place when the thing *has* a picture and
   * happens to be missing one — a user without an uploaded photo is still a
   * face-shaped hole. For something that could never have had one, a large
   * square holding the first letter of a title printed beside it is the same
   * character twice at two sizes.
   */
  avatar?: boolean;
  rows: DetailAsideRow[];
}

/**
 * The identity panel of a detail page: a thumbnail and title above a dense
 * label/value list.
 *
 * Dense rather than a marketing hero — the list is what a reader scans, so it
 * is a `<dl>` of small caps labels over their values, and a row with nothing
 * to say is left out by the caller rather than rendered empty.
 *
 * Extracted from the admin user detail page and shared by every detail page
 * since, which is why the clipboard behaviour lives here: each of them wants
 * a copyable id, and each of them had reimplemented it. It moved out of
 * `components/admin/` alongside {@link DetailLayout} once a non-admin page
 * (Lore's Epic view) became a consumer.
 */
export const DetailAside = (props: DetailAsideProps) => {
  const { tr } = useI18n();

  // Which row last had its value copied, so only that row shows the tick.
  const [copiedLabel, setCopiedLabel] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (row: DetailAsideRow) => {
    if (!row.copy) return;
    try {
      await navigator.clipboard.writeText(row.copy);
      setCopiedLabel(row.label);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedLabel(undefined), 1_500);
    } catch {
      // clipboard may be unavailable (insecure context); ignore
    }
  };

  const initial = (props.fallback ?? props.title ?? "?")
    .charAt(0)
    .toUpperCase();

  const showAvatar = props.avatar !== false;
  const header = showAvatar || props.title;

  return (
    <div className="flex flex-col gap-4">
      {header ? (
        <div className="flex items-center gap-3">
          {showAvatar && props.imageFileId ? (
            <UserAvatar
              fileId={props.imageFileId}
              alt={props.title ?? ""}
              className="size-10 rounded-md"
              fallback={<span className="text-sm">{initial}</span>}
            />
          ) : showAvatar ? (
            <Avatar className="size-10 rounded-md after:rounded-md">
              {props.image && (
                <AvatarImage
                  src={props.image}
                  alt={props.title ?? ""}
                  className="rounded-md"
                />
              )}
              <AvatarFallback className="rounded-md">{initial}</AvatarFallback>
            </Avatar>
          ) : null}
          {props.title ? (
            <span
              className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight"
              title={props.title}
            >
              {props.title}
            </span>
          ) : null}
        </div>
      ) : null}
      {/* The list is a bordered card whose rows are divided from each other,
          rather than a run of rows separated by whitespace.

          It replaced a single `border-t` above the list, which existed only
          to separate it from the header and had to be dropped when there was
          no header to separate it from (a top border with empty space above
          it reads as a clipped element). The card's own border does that job
          on every side, so the conditional is gone: the panel looks the same
          whether or not a title sits above it.

          `divide-y` instead of a border on each row: a border-bottom on all
          of them doubles up against the card's own bottom edge, and skipping
          the last one by hand is the rule `divide-y` already encodes.

          `gap-3` had to go with it. Rows that are spaced apart AND ruled show
          the rule floating in the gap rather than meeting the rows it
          divides; `py-2.5` inside each row is what carries the rhythm now.

          `overflow-hidden` for the corners: the card paints a background, so
          the first and last rows sit in the rounded corners and would square
          them off without it.

          That background is the table header's - `bg-muted` under a
          `--bevel` line - because this panel is the same kind of thing:
          chrome that frames the page rather than body the reader is in. Two
          adjacent lines of opposite polarity read as a fold, which is what
          lifts the surface off the page instead of leaving it drawn onto it.
          Same pair on `PlateTabBar`.

          The bevel is on each ROW, not once on the card, so every row is its
          own slab and the stack reads as slabs stacked rather than as one
          slab ruled into sections. Each row already has the line the bevel
          folds against: `divide-y` gives rows 2..n a `border-t`, and the
          card's own border closes the first one, which is why the same class
          on every row lands the same way on all of them. */}
      <dl className="bg-muted flex flex-col divide-y overflow-hidden rounded-lg border text-sm">
        {props.rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-0.5 px-3 py-2.5 shadow-[inset_0_1px_0_0_var(--bevel)]"
          >
            <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {row.label}
            </dt>
            <dd className="min-w-0">
              {row.copy ? (
                <div className="flex items-center gap-1">
                  {row.value ?? (
                    <code
                      className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs"
                      title={row.copy}
                    >
                      {row.copy}
                    </code>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => copy(row)}
                    aria-label={String(
                      tr("admin.detail.copyValue", {
                        default: `Copy ${row.label}`,
                        args: [row.label],
                      }),
                    )}
                    // No background override, even though `ghost` hovers to
                    // `bg-muted` and the card is now `bg-muted` too. That
                    // class does not resolve to the opaque token: `styles.css`
                    // redirects it to `--state-layer`, a 10% `--foreground`
                    // wash that DARKENS in light and lifts in dark, so it
                    // reads over whatever surface it lands on. A literal
                    // `hover:bg-background` here looked correct in dark and
                    // went white-on-grey in light.
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {copiedLabel === row.label ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
