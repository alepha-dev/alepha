import { $context } from "alepha";
import type {
  PageConfigSchema,
  PagePrimitive,
  TPropsDefault,
  TPropsParentDefault,
} from "alepha/react/router";
import { $pageNav, type PageNavOptions } from "../nav-shell/nav-page.tsx";
import { AdminRouter } from "./admin-router.tsx";

/**
 * `$pageNav` already parented to {@link AdminRouter}'s `/admin` shell — the
 * one-call form of "a page inside the shared admin shell". It exists because
 * the alternative — injecting `AdminRouter` and writing
 * `parent: this.admin.layout` by hand on every page — puts the rules of that
 * composition nowhere an author will read them.
 *
 * It carries the `$` prefix to sit with the framework's other declarations at
 * a call site, but it is a plain function wrapping `$pageNav` — which in turn
 * wraps `$page` — rather than a `createPrimitive` primitive. Nothing about
 * its lifecycle differs from declaring `$page` yourself.
 *
 * The page appears in the shell's sidebar with no separate registration
 * step: `useNavEntries` walks the parent chain and reads each page's own
 * `nav`, the same as any other page hung off `AdminRouter.layout`.
 *
 * **Calling this registers `AdminRouter`.** Declaring even one page this way
 * mounts the whole `/admin` shell, including its ten built-in pages (Users,
 * Sessions, Jobs, …) — an admin page without the admin shell around it is
 * not a thing. This is the intended reading, but it is a real side effect:
 * an application that wants `/admin` to carry only its own pages, with none
 * of the built-ins, must build its own layout page instead of reaching for
 * this helper.
 *
 * **Take `order: 100` or above, or declare your own `nav.group`.** The
 * built-ins occupy `Identity` (orders 1-3) and `Operations` (orders 4-9),
 * and `useNavEntries` sorts groups by their smallest member — a page at a
 * lower order silently reshuffles the shared sidebar.
 *
 * **Gate with `can: () => this.someApi.someAction.can()`, not with
 * `permission` alone.** A permission named by this page's own `$secure` is
 * self-declaring: `$secure` registers it into `SecurityProvider` at
 * definition time, so an admin holding the `*` wildcard is granted it
 * whether or not any controller backing the page exists — the entry would
 * stay visible over a dead API. An action name resolves against
 * `/api/_links`, a registry built only from actions the server actually
 * registered, so a page whose backend never shipped never appears for
 * anyone to be granted.
 *
 * ```tsx
 * class ShopAdminRouter {
 *   products = $pageAdmin({
 *     path: "/products",
 *     nav: { label: "Catalogue", icon: <Gem />, group: "Commerce", order: 100 },
 *     can: () => this.productApi.commerceAdminProductList.can(),
 *     lazy: () => import("./AdminProducts.tsx"),
 *   });
 * }
 * ```
 */
export const $pageAdmin = <
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
>(
  options: Omit<PageNavOptions<TConfig, TProps, TPropsParent>, "parent">,
): PagePrimitive<TConfig, TProps, TPropsParent> => {
  const { alepha } = $context();
  const admin = alepha.inject(AdminRouter);
  return $pageNav<TConfig, TProps, TPropsParent>({
    ...options,
    parent: admin.layout,
  } as PageNavOptions<TConfig, TProps, TPropsParent>);
};
