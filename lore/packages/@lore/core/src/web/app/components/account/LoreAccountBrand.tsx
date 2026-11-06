import { SidebarBackHeader } from "@alepha/ui/shell";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { UserRound } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";

/**
 * Lore's account sidebar header: a back arrow home, then "Account", the
 * same shape as the Admin Panel's header.
 *
 * `/account` is a root shell like `/admin`: the project sidebar and its
 * links are gone while it is open, so the arrow is the way back. It is
 * `@alepha/ui`'s `SidebarBackHeader`, which keeps the arrow and drops the
 * words when the sidebar folds to its icon rail.
 *
 * Mounted through a lazy import in `index.ts`, so the account chrome is not
 * part of the eager bundle every Lore page loads.
 */
const LoreAccountBrand = () => {
  const router = useRouter();
  const { tr } = useI18n<I18n, "en">();

  return (
    <SidebarBackHeader
      href={router.path("home")}
      label={tr("account.brand.back")}
    >
      <UserRound className="size-4 shrink-0" />
      <span
        className="truncate text-sm font-semibold tracking-tight"
        data-testid="lore-account-brand"
      >
        {tr("account.brand.subtitle")}
      </span>
    </SidebarBackHeader>
  );
};

export default LoreAccountBrand;
