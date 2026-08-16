import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { DropdownMenuSeparator } from "@alepha/ui/components/ui/dropdown-menu";
import { cn } from "@alepha/ui/lib/utils";
import { useRouter } from "alepha/react/router";
import type { ReactNode } from "react";

export interface AppActionsProps {
  /**
   * Extra menu items appended to the account dropdown, below the built-ins
   * and above Logout. For an application-specific destination — "My orders",
   * "Billing" — that belongs with the account rather than in the page chrome.
   */
  children?: ReactNode;

  /**
   * Rendered to the left of the cluster: a search trigger, a create button,
   * anything the surface wants adjacent to these controls.
   */
  before?: ReactNode;

  /**
   * Route name pushed by the "Admin Panel" item. The item is hidden anyway
   * unless the viewer holds `admin:ui`.
   *
   * @default "admin"
   */
  adminRouteName?: string;

  /**
   * Route name pushed by the signed-out state's sign-in button.
   *
   * @default "login"
   */
  loginRouteName?: string;

  /**
   * Labels, for an application that localises its chrome. Omitted entries
   * fall back to each button's own English default.
   */
  labels?: {
    language?: string;
    signIn?: string;
    admin?: string;
    account?: string;
    logout?: string;
  };

  className?: string;
}

/**
 * The ambient controls every signed-in surface carries: language, theme,
 * dark mode, account.
 *
 * ### Why this is one component rather than four imports
 *
 * It was four imports, in three places — `AdminLayout`, `AccountLayout` and
 * `apps/lore`'s own header — and they had already drifted: admin rendered no
 * theme switcher, and Lore's account menu pushed a route that no longer
 * existed. A cluster that every shell rebuilds by hand is a cluster where
 * each copy is one refactor away from being subtly wrong.
 *
 * ### Each button decides whether it has anything to offer
 *
 * There is no "show the language switcher?" prop, and there should not be:
 * `ButtonLanguage` and `ButtonTheme` already return `null` at one or fewer
 * options, reading the real registry rather than a flag a caller has to keep
 * in sync. So an application with a single locale and a single theme renders
 * exactly two controls here, and gains the others the day it registers a
 * second — with no change at any call site.
 *
 * `ButtonUser` likewise renders a sign-in button when signed out and the
 * account menu when signed in, and `ButtonUser.AccountMenuItem` hides itself
 * when no `account` route is mounted.
 *
 * ### What it deliberately does not include
 *
 * Search. `AdminLayout` keeps its ⌘K trigger outside this cluster because the
 * Spotlight open-state is local to that layout, so a shared component could
 * never own it — and Lore's own search is a field-sized element that reads as
 * a different kind of control next to four icons. Pass it via `before` when a
 * surface wants it adjacent.
 */
export const AppActions = (props: AppActionsProps) => {
  const router = useRouter<any>();

  return (
    <div className={cn("flex items-center gap-1", props.className)}>
      {props.before}
      <ButtonLanguage variant="ghost" label={props.labels?.language} />
      <ButtonTheme variant="ghost" />
      <ButtonDark variant="ghost" />
      <ButtonUser
        variant="ghost"
        signInLabel={props.labels?.signIn}
        onSignIn={() => router.push(props.loginRouteName ?? "login")}
      >
        <ButtonUser.Email />
        {/* Account before admin — see `ButtonUser`'s `DefaultMenu` for why. */}
        <ButtonUser.AccountMenuItem label={props.labels?.account} />
        {/*
          `routeName`, not `onClick`: both of these are destinations, so they
          render as real anchors and keep ⌘-click and open-in-new-tab.
        */}
        <ButtonUser.AdminMenuItem
          label={props.labels?.admin}
          routeName={props.adminRouteName}
        />
        {props.children}
        <DropdownMenuSeparator />
        <ButtonUser.LogoutMenuItem label={props.labels?.logout} />
      </ButtonUser>
    </div>
  );
};
