import { Personal } from "alepha/react";
import type { ReactNode } from "react";

import { ButtonUserAccountMenuItem } from "./ButtonUserAccountMenuItem.tsx";
import { ButtonUserAdminMenuItem } from "./ButtonUserAdminMenuItem.tsx";
import { ButtonUserContent } from "./ButtonUserContent.tsx";
import { ButtonUserEmail } from "./ButtonUserEmail.tsx";
import { ButtonUserLogoutMenuItem } from "./ButtonUserLogoutMenuItem.tsx";
import { ButtonUserPlaceholder } from "./ButtonUserPlaceholder.tsx";

export interface ButtonUserProps {
  /**
   * Custom menu items rendered between the email header and the logout
   * footer. When omitted, a default menu is rendered: email + account + admin
   * (when permitted) + logout. When provided, the consumer is responsible for the
   * full layout — use `ButtonUser.Email`, `ButtonUser.AdminMenuItem`,
   * `ButtonUser.LogoutMenuItem` as building blocks.
   */
  children?: ReactNode;
  /**
   * Called when the user clicks the sign-in icon (logged-out state). When
   * absent, the icon button is disabled.
   */
  onSignIn?: () => void;
  /**
   * Called when the user clicks the default "Admin Panel" menu item. Has no
   * effect when `children` are provided. When absent, the admin item is
   * hidden even if the user has the permission.
   */
  onAdminClick?: () => void;
  /**
   * Aria-label and tooltip text for the logged-out (sign-in) state.
   * Defaults to `"Sign in"`.
   */
  signInLabel?: string;
  /**
   * Aria-label and tooltip text for the logged-in (account menu) state.
   * Defaults to `"Account menu"`.
   */
  menuLabel?: string;
  /**
   * Visual variant. Defaults to `"minimal"`. Pass `"outlined"` for a
   * bordered toolbar look.
   */
  variant?: "minimal" | "outlined";

  /**
   * Overrides what the signed-in button shows. Rarely needed: by default the
   * button already draws the viewer's own avatar (feedback #P2138, #Q2229).
   *
   * **The default.** When `useAuth().user.picture` is set, the button draws
   * {@link UserAvatar} at `size-7` inside the `size-9` icon button, so the
   * face fills the control the way the `size-4` glyph it replaces does not.
   * A viewer with NO picture keeps the bare `User` glyph rather than a glyph
   * in a filled circle: beside the ghost icons of `AppActions`, a filled
   * circle reads as a different kind of control. A picture that fails to
   * load lands on `UserAvatar`'s own fallback.
   *
   * **Which file route, and why.** `user.picture` is a file id in the
   * `avatars` bucket, and both routes that serve it belong to
   * `alepha/api/files`, not to an application, so the kit can build the URL
   * itself. It uses the AUTHENTICATED `/api/files/:id`: the default
   * `FileAccessProvider` lets the uploader and an admin read there with no
   * opt-in, while the anonymous `/api/public/files/:id` refuses everything
   * until the application opens the bucket in `assertPublic`, so a
   * `public` default would show the glyph in every application that did
   * not. The cost is edge caching, and for the viewer's OWN avatar it is
   * close to nothing: the response is `private, max-age=1y, immutable`, so
   * the browser keeps it across pages, and an edge cache would only have
   * shared it with viewers who never ask for it. One case still falls back
   * to the glyph under the default provider: an avatar an ADMIN set, whose
   * uploader is the admin rather than the viewer.
   *
   * Only reached when signed in - the signed-out branch returns above.
   */
  avatar?: ReactNode;
}

/**
 * Account button: shows a sign-in icon when logged out, a user icon with a
 * dropdown menu when logged in. Reads auth state via `useAuth()`.
 *
 * @example
 * // Default menu
 * <ButtonUser onSignIn={() => router.push("login")} onAdminClick={() => router.push("admin")} />
 *
 * @example
 * // Custom menu
 * <ButtonUser onSignIn={() => router.push("login")}>
 *   <ButtonUser.Email />
 *   <ButtonUser.AdminMenuItem onClick={() => router.push("admin")} />
 *   <DropdownMenuItem onClick={() => router.push("me")}>Profile</DropdownMenuItem>
 *   <DropdownMenuSeparator />
 *   <ButtonUser.LogoutMenuItem />
 * </ButtonUser>
 *
 * The button reads the visitor, so it is wrapped in `<Personal>`: a page
 * showing it is still cached for everyone (#E78), with a placeholder of the
 * same size in the shared HTML, replaced by the real button right after
 * hydration from the visitor's own state. On a page that is personal anyway,
 * the server renders the real button.
 */
export const ButtonUser = (props: ButtonUserProps) => (
  <Personal fallback={<ButtonUserPlaceholder variant={props.variant} />}>
    <ButtonUserContent {...props} />
  </Personal>
);

ButtonUser.Email = ButtonUserEmail;
ButtonUser.AdminMenuItem = ButtonUserAdminMenuItem;
ButtonUser.AccountMenuItem = ButtonUserAccountMenuItem;
ButtonUser.LogoutMenuItem = ButtonUserLogoutMenuItem;
