import { AppActions } from "@alepha/ui/components/app-actions/app-actions";
import { useI18n } from "alepha/react/i18n";
import type { I18n } from "../../../services/I18n.ts";

/**
 * Lore's ambient header controls — language, theme, dark mode, account.
 *
 * Thin on purpose: the cluster itself is `@alepha/ui`'s `AppActions`, shared
 * with the admin console and the `/account` area. What stays here is the only
 * Lore-specific part, the localised labels.
 *
 * This file used to build the cluster by hand, and that is how it came to
 * push a route called `me` — a name that stopped existing when the profile
 * pages moved to `/account`, and that kept compiling because `router.push`
 * falls back to a plain `string`. `ButtonUser.AccountMenuItem` now owns that
 * navigation, so no caller can get it wrong again.
 *
 * Search is NOT here. It lives in `ProjectView`'s topbar, left of Create
 * Quest, as an input-shaped trigger — this cluster is small ambient controls,
 * and a field-sized element reads as a different kind of thing beside them.
 * `HeaderActions` also renders off-project via `PageHeader`, where search has
 * nothing to search anyway.
 */
const HeaderActions = () => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <AppActions
      labels={{
        language: String(tr("header.actions.language")),
        signIn: String(tr("header.actions.login")),
        admin: String(tr("header.actions.admin" as never)),
        account: String(tr("header.actions.profile")),
        logout: String(tr("header.actions.logout")),
      }}
    />
  );
};

export default HeaderActions;
