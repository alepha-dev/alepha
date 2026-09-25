import type { AccountRouterOptions } from "@alepha/ui/account";
import { Tr } from "alepha/react/i18n";

import { Poincon } from "./components/Poincon.tsx";

/**
 * Shop's account chrome: the customer's `/account` area is a root shell like
 * `/admin`, so it carries the atelier's mark rather than the storefront's
 * header.
 *
 * Set from both `main.server.ts` and `main.browser.ts`, like
 * `shopAdminOptions`, because the brand is JSX. The brand keeps the Poinçon
 * and drops the words when the sidebar folds to its icon rail, for the reason
 * `adminChrome.tsx` gives.
 */
export const shopAccountOptions: AccountRouterOptions = {
  brand: (
    <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0">
      <Poincon titre="AA" className="shrink-0" />
      <span className="estampe text-xs group-data-[collapsible=icon]:hidden">
        <Tr k="account.brand" />
      </span>
    </div>
  ),
  // `accueil`, not the default "home": the storefront root page carries no
  // explicit `name:`, so its route name is its property key.
  homeRouteName: "accueil",
};
