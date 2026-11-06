import { SidebarBackHeader } from "@alepha/ui/shell";
import { useRouter } from "alepha/react/router";
import { LayoutDashboard } from "lucide-react";

/**
 * Lore's admin sidebar brand: a back-arrow to `home` beside the
 * "Admin Panel" title. Recovered from the deleted `AppAdminLayout`, and
 * drawn by `@alepha/ui`'s `SidebarBackHeader` since the account shell got
 * the same header, so the two cannot drift. Its own component rather than
 * inline JSX in `adminChrome.tsx`: `router.path("home")` needs a router, and
 * hooks have no place in a plain options object.
 */
export const AdminBrand = () => {
  const router = useRouter();

  return (
    <SidebarBackHeader href={router.path("home")} label="Back to home">
      <LayoutDashboard className="size-4 shrink-0" />
      <span className="text-sm font-semibold tracking-tight">Admin Panel</span>
    </SidebarBackHeader>
  );
};
