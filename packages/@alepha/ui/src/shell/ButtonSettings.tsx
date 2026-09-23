import * as React from "react";

void React;

import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import type { ReactNode } from "react";

import { DropdownMenuSeparator } from "../core/DropdownMenu.tsx";
import { cn } from "../core/utils.ts";
import { ButtonDark } from "./ButtonDark.tsx";
import { ButtonLanguage } from "./ButtonLanguage.tsx";
import { ButtonSettingsColorModeMenu } from "./ButtonSettingsColorModeMenu.tsx";
import { ButtonSettingsLanguageMenu } from "./ButtonSettingsLanguageMenu.tsx";
import { ButtonSettingsThemeMenu } from "./ButtonSettingsThemeMenu.tsx";
import { ButtonTheme } from "./ButtonTheme.tsx";
import { ButtonUser } from "./ButtonUser.tsx";

export interface ButtonSettingsProps {
  /**
   * Where language, theme and display mode go while the viewer is signed in.
   *
   * - `"menu"`: inside the account menu, between the destinations and
   *   Logout, so the header carries one button.
   * - `"buttons"`: icon buttons left of the account button, the way
   *   `AppActions` draws them.
   *
   * Signed out there is no menu to put them in, so they are buttons whatever
   * this says.
   *
   * @default "menu"
   */
  placement?: "menu" | "buttons";

  /**
   * Extra menu items appended to the account dropdown, below Admin Panel and
   * above the settings. For an application-specific destination that belongs
   * with the account rather than in the page chrome.
   */
  children?: ReactNode;

  /**
   * Rendered to the left of the cluster, in the same `flex gap-1` row.
   */
  before?: ReactNode;

  /**
   * Route name of the "Admin Panel" item. The item is hidden anyway unless
   * the viewer holds `admin:ui`.
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
   * Labels, for an application that names its chrome itself. An omitted
   * entry is read from the catalogue under `shell.settings.*`, English by
   * default and French through `uiFr`, so the admin console and the account
   * area are localised without passing any. `language`, `theme` and
   * `colorMode` name the control in both placements: the submenu in the
   * menu, the tooltip and `aria-label` as a button.
   */
  labels?: {
    signIn?: string;
    menu?: string;
    account?: string;
    admin?: string;
    logout?: string;
    language?: string;
    theme?: string;
    colorMode?: string;
    colorModeSystem?: string;
    colorModeDark?: string;
    colorModeLight?: string;
  };

  /**
   * Forwarded to {@link ButtonUser.avatar}: overrides what the signed-in
   * button shows. Absent, it draws the viewer's own picture when they have
   * one and the generic glyph when they do not.
   */
  avatar?: ReactNode;

  /**
   * Below `sm`, drop the settings BUTTONS and keep only the account button.
   * It never touches the menu, so a signed-in viewer on a phone still reaches
   * all three there under the default `placement`.
   */
  compact?: boolean;

  /**
   * Visual variant of every button. Defaults to `"minimal"`.
   */
  variant?: "minimal" | "outlined";

  className?: string;
}

/**
 * The account button with the viewer's settings attached: language, theme
 * and display mode, wrapped around {@link ButtonUser}.
 *
 * Signed out, it draws the four icon buttons `AppActions` draws: language,
 * theme, dark mode, sign in. Signed in, it draws ONE button, the avatar, and
 * the settings move into its menu:
 *
 * ```
 * ada@example.com
 * User Account
 * Admin Panel
 * ───────────
 * Language      ›
 * Theme         ›
 * Display Mode  ›
 * ───────────
 * Logout
 * ```
 *
 * Pass `placement="buttons"` to keep them as buttons once signed in too.
 *
 * Each part still decides whether it has anything to offer: language and
 * theme disappear, as a button or as a submenu, when one or fewer are
 * registered, and the account and admin items hide when their route is not
 * mounted or the viewer lacks `admin:ui`.
 */
export const ButtonSettings = (props: ButtonSettingsProps) => {
  const auth = useAuth();
  const router = useRouter<any>();
  const { tr } = useI18n();
  const given = props.labels ?? {};
  // Each key written out, not built from a list: the `uiFr` coverage spec
  // finds a key by its literal `tr("...")` call.
  const labels = {
    signIn: given.signIn ?? tr("shell.settings.signIn", { default: "Sign in" }),
    menu: given.menu ?? tr("shell.settings.menu", { default: "Account menu" }),
    account:
      given.account ??
      tr("shell.settings.account", { default: "User Account" }),
    admin:
      given.admin ?? tr("shell.settings.admin", { default: "Admin Panel" }),
    logout: given.logout ?? tr("shell.settings.logout", { default: "Logout" }),
    language:
      given.language ?? tr("shell.settings.language", { default: "Language" }),
    theme: given.theme ?? tr("shell.settings.theme", { default: "Theme" }),
    colorMode:
      given.colorMode ??
      tr("shell.settings.colorMode", { default: "Display Mode" }),
    colorModeSystem:
      given.colorModeSystem ??
      tr("shell.settings.colorModeSystem", { default: "System" }),
    colorModeDark:
      given.colorModeDark ??
      tr("shell.settings.colorModeDark", { default: "Dark" }),
    colorModeLight:
      given.colorModeLight ??
      tr("shell.settings.colorModeLight", { default: "Light" }),
  };
  const variant = props.variant ?? "minimal";
  const inMenu = !!auth.user && (props.placement ?? "menu") === "menu";

  return (
    <div className={cn("flex items-center gap-1", props.className)}>
      {props.before}
      {!inMenu && (
        // `contents` keeps the three direct children of the flex row and its
        // `gap-1`; `hidden` wins over it below the breakpoint.
        <div className={cn(props.compact ? "hidden sm:contents" : "contents")}>
          <ButtonLanguage variant={variant} label={labels.language} />
          <ButtonTheme variant={variant} label={labels.theme} />
          <ButtonDark variant={variant} label={labels.colorMode} />
        </div>
      )}
      <ButtonUser
        variant={variant}
        avatar={props.avatar}
        signInLabel={labels.signIn}
        menuLabel={labels.menu}
        onSignIn={() => router.push(props.loginRouteName ?? "login")}
      >
        <ButtonUser.Email />
        {/* Account before admin: see `ButtonUserDefaultMenu` for why. */}
        <ButtonUser.AccountMenuItem label={labels.account} />
        <ButtonUser.AdminMenuItem
          label={labels.admin}
          routeName={props.adminRouteName}
        />
        {props.children}
        {inMenu && (
          <>
            <DropdownMenuSeparator />
            <ButtonSettingsLanguageMenu label={labels.language} />
            <ButtonSettingsThemeMenu label={labels.theme} />
            <ButtonSettingsColorModeMenu
              label={labels.colorMode}
              labels={{
                system: labels.colorModeSystem,
                dark: labels.colorModeDark,
                light: labels.colorModeLight,
              }}
            />
          </>
        )}
        <DropdownMenuSeparator />
        <ButtonUser.LogoutMenuItem label={labels.logout} />
      </ButtonUser>
    </div>
  );
};

ButtonSettings.LanguageMenu = ButtonSettingsLanguageMenu;
ButtonSettings.ThemeMenu = ButtonSettingsThemeMenu;
ButtonSettings.ColorModeMenu = ButtonSettingsColorModeMenu;
