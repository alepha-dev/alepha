import type { ReactNode } from "react";

import { cn } from "../core/utils.ts";

export interface AccountPageProps {
  /**
   * Which frame the page sits in.
   *
   * - `table`: the `AdminPage` frame, `p-2` and a column that bounds its
   *   height, so a `DataTable` fills `main` and scrolls its own body.
   * - `form`: a centred `max-w-3xl` column that scrolls inside `main`, for a
   *   page of `SettingsSection` cards.
   */
  variant: "table" | "form";
  children: ReactNode;
  /**
   * Extra classes merged onto the frame.
   */
  className?: string;
}

/**
 * The frame of a page inside the account shell, one component so the two
 * frames are not copy-pasted across the kit and every application page.
 *
 * `main` is a bounded flex column (`NavShell fill`), so neither frame lets
 * the document scroll: `table` hands the height to the table, `form` scrolls
 * itself. The form column is the one scroll root on the page, which is what
 * keeps the sidebar and topbar still while a long form moves.
 */
export const AccountPage = (props: AccountPageProps) => {
  if (props.variant === "table") {
    return (
      <div
        data-slot="account-page"
        data-variant="table"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 p-2",
          props.className,
        )}
      >
        {props.children}
      </div>
    );
  }

  return (
    <div
      data-slot="account-page"
      data-variant="form"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 md:p-6",
          props.className,
        )}
      >
        {props.children}
      </div>
    </div>
  );
};
