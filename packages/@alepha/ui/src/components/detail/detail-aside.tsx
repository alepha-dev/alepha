import * as React from "react";

void React;

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alepha/ui/components/ui/avatar";
import { Button } from "@alepha/ui/components/ui/button";
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
  /** Thumbnail or avatar source. Falls back to {@link fallback}. */
  image?: string;
  /** Shown in place of a missing image. Defaults to the title's initial. */
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
          {showAvatar && (
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
          )}
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
      {/* The rule keeps the list separated FROM the header, so with no
          header there is nothing to separate it from — a top border with
          empty space above it reads as a clipped element. */}
      <dl
        className={
          header
            ? "flex flex-col gap-3 border-t pt-4 text-sm"
            : "flex flex-col gap-3 text-sm"
        }
      >
        {props.rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
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
