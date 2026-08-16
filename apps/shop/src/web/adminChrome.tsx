import type { AdminRouterOptions } from "@alepha/ui/components/admin/admin-router-options";
import { Tr } from "alepha/react/i18n";
import { Poincon } from "./components/Poincon.tsx";

/**
 * Shop's admin chrome.
 *
 * The Poinçon-plus-title cluster is what the deleted `AdminLayout.tsx`
 * carried as its `brand`. `indexPath` sends a bare `/admin` to the
 * catalogue rather than the built-in users list: the atelier's back office
 * is a catalogue, and Users is incidental to it.
 *
 * The brand text goes through `<Tr>` rather than a hardcoded French string,
 * the same reason the nav labels in `AppRouter.tsx` do — this object is
 * built once at module scope, outside any component, so a hook-calling
 * component wrapped in a `ReactNode` is what keeps the label reactive to a
 * language switch instead of freezing it at boot.
 */
export const shopAdminOptions: AdminRouterOptions = {
  /*
   * The `group-data-[collapsible=icon]:*` classes are what make this survive
   * the sidebar collapsing to a rail.
   *
   * `SidebarHeader` renders the brand as-is at whatever width it asks for,
   * while the rail around it shrinks to roughly one icon. Without these, the
   * title had nowhere to go and wrapped — "ATELIER · GESTION" over three
   * lines, a header tall enough to overlap the collapse toggle, and the
   * Poinçon squeezed out of view entirely.
   *
   * So the mark stays (it is exactly what an icon rail wants) and the words
   * go. `justify-center` re-centres the mark once the text beside it is gone,
   * and the horizontal padding drops so the rail's own centring is not fought.
   * `AdminBrand` in `apps/lore` carries the same three classes for the same
   * reason.
   */
  brand: (
    <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
      <Poincon titre="AA" className="shrink-0" />
      <span className="estampe text-xs group-data-[collapsible=icon]:hidden">
        <Tr k="admin.brand" />
      </span>
    </div>
  ),
  // `accueil`, not the default "home" — shop's storefront root page carries
  // no explicit `name:`, so its route name is its property key.
  homeRouteName: "accueil",
  indexPath: "/admin/pieces",
};
