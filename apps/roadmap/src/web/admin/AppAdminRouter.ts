import { $page } from "alepha/react/router";

/**
 * Stub admin router. Full mantine-based admin routes were removed during the
 * @alepha/ui migration. Re-implement with @alepha/ui admin primitives if needed.
 */
export class AppAdminRouter {
  adminLayout = $page({
    path: "/admin",
    component: () => null,
  });
}
