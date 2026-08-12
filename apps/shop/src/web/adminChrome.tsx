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
  brand: (
    <div className="flex items-center gap-3">
      <Poincon titre="AA" />
      <span className="estampe text-xs">
        <Tr k="admin.brand" />
      </span>
    </div>
  ),
  // `accueil`, not the default "home" — shop's storefront root page carries
  // no explicit `name:`, so its route name is its property key.
  homeRouteName: "accueil",
  indexPath: "/admin/pieces",
};
