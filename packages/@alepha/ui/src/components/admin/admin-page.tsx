import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface AdminPageProps {
  children: ReactNode;
  /**
   * Extra classes merged onto the standard page shell. Most pages won't need
   * this — the default `p-6 flex min-h-0 flex-1 flex-col gap-3` shell is what
   * the admin list/detail pages share.
   */
  className?: string;
}

/**
 * Standard admin page shell — the `p-6`, column-flex, scroll-bounding wrapper
 * that every admin page used to copy-paste.
 */
export const AdminPage = (props: AdminPageProps) => (
  <div
    className={cn("flex min-h-0 flex-1 flex-col gap-3 p-6", props.className)}
  >
    {props.children}
  </div>
);
