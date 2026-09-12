import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface AdminPageProps {
  children: ReactNode;
  /**
   * Extra classes merged onto the standard page shell. Most pages won't need
   * this: the default `p-2 flex min-h-0 flex-1 flex-col gap-3` shell is what
   * the admin list/detail pages share. A page that is NOT a table passes its
   * own padding here, as `AdminDashboard` does.
   */
  className?: string;
}

/**
 * Standard admin page shell: the column-flex, scroll-bounding wrapper that
 * every admin page used to copy-paste.
 *
 * The frame is `p-2`, 8px, because **this shell is a table shell**: 13 of its
 * 14 call sites put an `AlephaTable` straight into it, and a table already
 * draws its own edge, so the `p-6` this used to be gave 24px down each side
 * to nothing (#Q2266).
 *
 * ⚠️ 8px is the frame of a TABLE page, not of every page. #Q2266 read it as
 * a back-office-wide rule and took the gutter off the card pages, the
 * dashboards, the form tabs and the release tabs as well, which was the
 * regression #Q2291 undid. A page whose body is cards or a form keeps `p-6`
 * (`p-4` in Lore): pass it as `className` here, the way `AdminDashboard`
 * does.
 */
export const AdminPage = (props: AdminPageProps) => (
  <div
    className={cn("flex min-h-0 flex-1 flex-col gap-3 p-2", props.className)}
  >
    {props.children}
  </div>
);
