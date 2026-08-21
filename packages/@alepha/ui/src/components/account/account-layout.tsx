import { AccountHeader } from "@alepha/ui/components/account/account-header";
import { SettingsLayout } from "@alepha/ui/components/settings/settings-layout";
import { SettingsNav } from "@alepha/ui/components/settings/settings-nav";
import { useStore } from "alepha/react";
import { NestedView } from "alepha/react/router";

import { useNavEntries } from "../nav-shell/use-nav-entries.ts";
import { accountRouterOptionsAtom } from "./account-router-options.tsx";

/**
 * The account shell: a centred column with a settings rail, deliberately not
 * the admin console's chrome.
 *
 * The rail is derived from the route subtree anchored at `account` — every
 * page carries its own `nav`, so there is no hand-synced list and a page
 * added with `$pageAccount` appears without registering anywhere.
 *
 * Two things this does *not* do, both on purpose:
 *
 * - **No `<ColorScheme />`.** `AdminLayout` mounts one because `/admin` is
 *   never a child of the application's layout, so nothing else would apply
 *   the dark-mode class to `<html>`. This shell is normally adopted *into*
 *   the application's own layout (see `AccountRouter`'s `children` note), and
 *   an application mounting it standalone is already supplying `header` and
 *   owns its chrome. A second component writing to `<html>` would be the
 *   surprise, not the service.
 * - **No scroll container by default.** The page scrolls, and a nested
 *   `overflow-auto` would strand the sticky rail against the wrong scroll
 *   root. An application whose own shell has already taken the viewport
 *   height and hidden its overflow has no page scroll to lend, and opts in
 *   with `fill` on the options atom — see `SettingsLayout`.
 *
 * `useNavEntries` returns entries already filtered by `can` and permission,
 * and sorted by group then order — and its `NavEntry` is structurally a
 * superset of `SettingsNavItem`, so it passes straight through. That is safe
 * here specifically because none of these routes is parameterised: see
 * `SettingsNav` for why it takes resolved items rather than a route name.
 */
export const AccountLayout = () => {
  const [options] = useStore(accountRouterOptionsAtom);
  const entries = useNavEntries({ root: "account" });

  return (
    <SettingsLayout
      className={options.className}
      fill={options.fill}
      /*
        `!== undefined`, not `??`. `null ?? x` yields `x`, so nullish
        coalescing would silently ignore `header: null` — the documented way
        to say "this account area is nested in my own chrome, draw no bar".
        Absent means default; explicit null means none.
      */
      header={
        options.header !== undefined ? (
          options.header
        ) : (
          <AccountHeader homeRouteName={options.homeRouteName} />
        )
      }
      nav={<SettingsNav items={entries} />}
    >
      <NestedView />
    </SettingsLayout>
  );
};

export default AccountLayout;
