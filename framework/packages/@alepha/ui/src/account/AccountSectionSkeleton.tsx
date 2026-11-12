import { Skeleton } from "../core/Skeleton.tsx";
import { AccountPage } from "./AccountPage.tsx";

export interface AccountSectionSkeletonProps {
  /**
   * The frame the section will draw in once its data is there, so the
   * skeleton holds the same place: rows for a table, cards for a form.
   */
  variant: "table" | "form";
}

/**
 * What an account section shows while it fetches its own data.
 */
export const AccountSectionSkeleton = (props: AccountSectionSkeletonProps) => (
  <AccountPage variant={props.variant}>
    <div
      data-slot="account-section-skeleton"
      aria-busy="true"
      className="flex flex-col gap-3"
    >
      {props.variant === "table" ? (
        <>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </>
      ) : (
        <>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </>
      )}
    </div>
  </AccountPage>
);
