import { ButtonSettings } from "@alepha/ui/shell";
import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

import type { I18n } from "../../../services/I18n.ts";

export interface HeaderActionsProps {
  /**
   * Rendered inside the cluster, immediately left of its first button.
   *
   * A passthrough to `ButtonSettings`'s own `before`, which puts the node in
   * the same `flex gap-1` as the icon buttons — so it inherits their spacing
   * instead of approximating it from outside. `ProjectView` passes the search
   * trigger through here.
   */
  before?: ReactNode;
}

/**
 * Lore's ambient header controls — language, theme, dark mode, account.
 *
 * Thin on purpose: the cluster itself is `@alepha/ui`'s `ButtonSettings`.
 * What stays here is the only Lore-specific part, the localised labels.
 *
 * Signed in, the header carries ONE button, the avatar, and language, theme
 * and display mode are submenus of its menu. Signed out, they are the icon
 * buttons they always were, beside the sign-in one. The admin console and
 * the `/account` area still draw all four as buttons through `AppActions`.
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
 * ⚠️ `compact` is what drops the language, theme and dark mode BUTTONS
 * below `sm`, which since the settings moved into the menu only ever applies
 * to a signed-out visitor. It is passed HERE and not as a kit default because
 * `AppActions` is also the account area's header, where a phone reader has
 * to keep reaching all three.
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
    <ButtonSettings
      // The header carried eight icon buttons on a phone, half of them
      // settings a reader changes about once (feedback #P2144). Signed in
      // they now live in the account menu; this drops them for a signed-out
      // visitor on a phone.
      compact
      before={props.before}
      labels={{
        signIn: tr("header.actions.login"),
        account: tr("header.actions.profile"),
        admin: tr("header.actions.admin"),
        logout: tr("header.actions.logout"),
        language: tr("header.actions.language"),
        theme: tr("header.actions.theme"),
        colorMode: tr("header.actions.colorMode"),
        colorModeSystem: tr("header.actions.colorMode.system"),
        colorModeDark: tr("header.actions.colorMode.dark"),
        colorModeLight: tr("header.actions.colorMode.light"),
      }}
    />
  );
};

export default HeaderActions;
