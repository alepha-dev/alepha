import { $context } from "alepha";
import type {
  PageConfigSchema,
  PagePrimitive,
  TPropsDefault,
  TPropsParentDefault,
} from "alepha/react/router";
import { $pageNav, type PageNavOptions } from "../nav-shell/nav-page.tsx";
import { AccountRouter } from "./account-router.tsx";

/**
 * `$pageNav` already parented to {@link AccountRouter}'s `/account` shell —
 * the one-call form of "a page inside the shared account area".
 *
 * It carries the `$` prefix to sit with the framework's other declarations at
 * a call site, but it is a plain function wrapping `$pageNav`, which wraps
 * `$page`. Nothing about its lifecycle differs from declaring `$page`
 * yourself.
 *
 * The page appears in the rail with no separate registration: the layout
 * reads `useNavEntries({ root: "account" })`, which walks the parent chain
 * and reads each page's own `nav`.
 *
 * **Calling this registers `AccountRouter`.** Declaring even one page this
 * way mounts the whole `/account` shell including its five built-in pages —
 * an account page without the account area around it is not a thing. That is
 * the intended reading, but it is a real side effect: an application wanting
 * `/account` to carry only its own pages must build its own layout instead.
 *
 * **Take `order: 100` or above, or declare your own `nav.group`.** The
 * built-ins occupy `Account` (order 1) and `Security` (orders 2-5), and
 * `useNavEntries` sorts groups by their smallest member — a page at a lower
 * order silently reshuffles the shared rail.
 *
 * **Gate with `can: () => this.someApi.someAction.can()`, not `permission`
 * alone.** A permission named by this page's own `$secure` is self-declaring:
 * `$secure` registers it into `SecurityProvider` at definition time, so it
 * exists whether or not any controller backing the page does. An action name
 * resolves against `/api/_links`, which is built only from actions the server
 * actually registered.
 *
 * ```tsx
 * class LoreAccountRouter {
 *   protected readonly invitationApi = $client<InvitationController>();
 *
 *   invitations = $pageAccount({
 *     path: "/invitations",
 *     name: "accountInvitations",
 *     nav: { label: "Invitations", icon: <Mail />, group: "Lore", order: 100 },
 *     can: () => this.invitationApi.listMyInvitations.can(),
 *     lazy: () => import("./MyInvitations.tsx"),
 *   });
 * }
 * ```
 */
export const $pageAccount = <
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
>(
  options: Omit<PageNavOptions<TConfig, TProps, TPropsParent>, "parent">,
): PagePrimitive<TConfig, TProps, TPropsParent> => {
  const { alepha } = $context();
  const account = alepha.inject(AccountRouter);
  return $pageNav<TConfig, TProps, TPropsParent>({
    ...options,
    parent: account.layout,
  } as PageNavOptions<TConfig, TProps, TPropsParent>);
};
