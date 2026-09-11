import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface AdminPageProps {
  children: ReactNode;
  /**
   * Extra classes merged onto the standard page shell. Most pages won't need
   * this: the default `p-2 flex min-h-0 flex-1 flex-col gap-3` shell is what
   * the admin list/detail pages share.
   */
  className?: string;
}

/**
 * Standard admin page shell: the column-flex, scroll-bounding wrapper that
 * every admin page used to copy-paste.
 *
 * The frame is `p-2`, 8px, since #Q2266. It was `p-6`, and a table or a
 * three-pane editor gave 24px down each side to nothing. Pages that cannot
 * use this shell (Parameters, the user detail tabs) carry the same `p-2`, and
 * so do Lore's project pages, so the whole back office keeps one gutter.
 */
export const AdminPage = (props: AdminPageProps) => (
  <div
    className={cn("flex min-h-0 flex-1 flex-col gap-3 p-2", props.className)}
  >
    {props.children}
  </div>
);
