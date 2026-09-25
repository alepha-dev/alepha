import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import LoreLogo from "../shared/LoreLogo.tsx";

/**
 * Lore's account sidebar brand: the Lore mark and name, linking home, with
 * "Account" under it.
 *
 * `/account` is a root shell like `/admin`, so this is where Lore's own
 * identity lives on those pages. A real `<Link>` rather than a button, so
 * the way home can be opened in a new tab. The words hide when the sidebar
 * folds to its icon rail, and the mark stays, for the reason
 * `AdminRouterOptions.brand` gives.
 *
 * Mounted through a lazy import in `index.ts`, so the account chrome is not
 * part of the eager bundle every Lore page loads.
 */
const LoreAccountBrand = () => {
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();

  return (
    <Link
      href={router.path("home")}
      className="hover:bg-hover flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
      data-testid="lore-account-brand"
    >
      <LoreLogo size={22} className="size-[22px] shrink-0" />
      <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
        <span className="text-sm font-semibold tracking-tight">Lore</span>
        <span className="text-muted-foreground text-xs">
          {tr("account.brand.subtitle")}
        </span>
      </div>
    </Link>
  );
};

export default LoreAccountBrand;
