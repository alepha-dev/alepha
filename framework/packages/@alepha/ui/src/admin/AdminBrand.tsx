import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import { SidebarBackHeader } from "../shell/SidebarBackHeader.tsx";

export interface AdminBrandProps {
  /**
   * The route the back arrow leads to: `AdminRouterOptions.homeRouteName`.
   *
   * @default "home"
   */
  homeRouteName?: string;
}

/**
 * The admin sidebar's default brand: a back arrow to the application's home
 * beside "Admin Panel", with no icon (#Q3570).
 *
 * It used to be an icon and "Admin", with no way out of `/admin`, so every
 * application that wanted the arrow drew its own brand. `brand` still
 * replaces the whole thing.
 *
 * ⚠️ An application with no route by that name gets `/`: a brand that threw
 * would take the whole admin shell down with it.
 */
export const AdminBrand = (props: AdminBrandProps) => {
  const { tr } = useI18n();
  // Untyped on purpose: the home route is the application's, named at
  // runtime by an option, which this package's routers cannot name.
  const router = useRouter<any>();
  let home = "/";
  try {
    home = router.path(props.homeRouteName ?? "home");
  } catch {
    // No such route: `/` is the application's home by convention.
  }

  return (
    <SidebarBackHeader
      href={home}
      label={tr("admin.nav.backToSite", { default: "Back to site" })}
    >
      <span className="truncate text-sm font-semibold tracking-tight">
        {tr("admin.nav.adminPanel", { default: "Admin Panel" })}
      </span>
    </SidebarBackHeader>
  );
};
