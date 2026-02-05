import type { DashboardShellProps } from "@alepha/ui";
import { $context } from "alepha";
import { AdminRouter } from "../AdminRouter.ts";

/**
 * Register Admin UI components and get the AdminRouter instance.
 */
export const $uiAdmin = (optsFn?: (a: AdminRouter) => DashboardShellProps) => {
  const { alepha } = $context();
  const adminRouter = alepha.inject(AdminRouter);

  if (optsFn) {
    adminRouter.configFn = optsFn;
  }

  return adminRouter;
};
