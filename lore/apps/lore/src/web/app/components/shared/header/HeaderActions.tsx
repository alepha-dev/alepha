import { AppActions } from "@alepha/ui/components/app-actions/app-actions";
import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

import type { I18n } from "../../../services/I18n.ts";

export interface HeaderActionsProps {
  /**
   * Rendered inside the cluster, immediately left of the language button.
   *
   * A passthrough to `AppActions`'s own `before`, which puts the node in the
   * same `flex gap-1` as the four icon buttons — so it inherits their spacing
   * instead of approximating it from outside. `ProjectView` passes the search
   * trigger through here.
   */
  before?: ReactNode;
}

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
 * The account button's avatar (feedback #P2138) is no longer Lore's to
 * supply: `ButtonUser` draws the viewer's picture itself since #Q2229, with
 * the same two rules this file used to apply - no picture keeps the bare
 * glyph, and the avatar is `size-7` in the `size-9` button - so the admin
 * console and `/account` show it too. It goes through the authenticated
 * file route, which the browser caches for a year; see `ButtonUser.avatar`.
 *
 * ⚠️ `compact` is what drops language, theme and dark mode below `sm`. It
 * is passed HERE and not inside `AppActions` itself, because the cluster is
 * also the account area's header, and those three live nowhere else in the
 * product: hiding them everywhere would leave a phone reader unable to
 * switch to their own language at all.
 *
 * Search now arrives through `before` rather than as a sibling. It used to be
 * excluded on the grounds that a field-sized element reads as a different kind
 * of thing beside small ambient controls — true of the 224px input-shaped
 * trigger it was, and no longer true of the icon it became. It is still not
 * rendered here by default: `ProjectView` passes it, because `HeaderActions`
 * also renders off-project via `PageHeader` and the decision of whether search
 * belongs on a surface is the surface's to make.
 */
const HeaderActions = (props: HeaderActionsProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <AppActions
      // The header carried eight icon buttons on a phone, half of them
      // settings a reader changes about once (feedback #P2144). Only Lore's
      // app chrome passes this: `AccountHeader` does not, so `/account` is
      // where a phone reader still changes language and theme.
      compact
      before={props.before}
      labels={{
        language: String(tr("header.actions.language")),
        signIn: String(tr("header.actions.login")),
        admin: String(tr("header.actions.admin")),
        account: String(tr("header.actions.profile")),
        logout: String(tr("header.actions.logout")),
      }}
    />
  );
};

export default HeaderActions;
