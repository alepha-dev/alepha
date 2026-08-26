import type { ProductController } from "@alepha/commerce";
import type {
  AdminOrderController,
  AdminProductController,
} from "@alepha/commerce/admin";
import type { CheckoutController } from "@alepha/commerce/checkout";
import type { AdminShippingController } from "@alepha/commerce/shipping";
import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { $pageAdmin } from "@alepha/ui/components/admin/admin-router-page";
import { $atom, $inject, Alepha, z } from "alepha";
import { Tr } from "alepha/react/i18n";
import { $page, Redirection } from "alepha/react/router";
import { $client } from "alepha/server/links";
import { Gem, Package, Truck } from "lucide-react";

import { Layout } from "./Layout.tsx";

/**
 * Every route in the shop.
 *
 * Pages are code-split through `lazy: () => import(…)`, and their data comes from
 * a `loader` that runs on the server — so the catalogue arrives with its content
 * already in the HTML, which is both faster to first paint and the only way a
 * search engine sees the pieces.
 *
 * ### Why loaders use `$client` and not the services directly
 *
 * The first version injected `CatalogService` here. It worked on the server and
 * broke in the browser: this class is part of the client bundle too, so it
 * dragged the ORM in with it and the page died on
 * `does not provide an export named '$repository'`.
 *
 * `$client` is the seam that exists for exactly this. On the server it dispatches
 * to the local handler in-process — no HTTP round trip, and no fetch to our own
 * hostname, which a Cloudflare Worker cannot do anyway. In the browser it becomes
 * a typed `fetch`. Same call, same types, both sides.
 */
/**
 * Set by the product loader when the slug matches nothing, read by that page's
 * `onServerResponse` to answer 404.
 *
 * An atom rather than a field on the router, because the store is per-request on
 * the server: a field would leak one visitor's missing product into the next
 * visitor's response.
 */
const produitIntrouvable = $atom({
  name: "shop.produitIntrouvable",
  schema: z.boolean(),
  default: false,
});

export class AppRouter {
  protected readonly alepha = $inject(Alepha);
  protected readonly produits = $client<ProductController>();
  protected readonly checkoutApi = $client<CheckoutController>();

  /*
   * The customer's own `/account` area — five pages and their rail, from
   * `@alepha/ui`.
   *
   * Injected rather than only listed in `ShopWeb.services` because the shop
   * mounts it *inside* its own chrome: `layout.children` below adopts
   * `account.layout`, and `ReactPageProvider` drops an adopted page from the
   * root set, so `/account/*` renders under the atelier's header and footer
   * instead of standing alone. Registering the service without adopting it
   * would put the account area at the root, outside the shop entirely.
   *
   * Nothing has to be added to the header for it: `<ButtonUser />`'s default
   * menu already composes `AccountMenuItem`, which hides itself unless a route
   * named `account` is registered. Mounting this is what reveals the entry.
   */
  protected readonly account = $inject(AccountRouter);

  // ── Back office (composed onto the shared shell) ────────────────────
  //
  // The three commerce screens live in `@alepha/commerce/admin` and
  // `@alepha/commerce/shipping`, deliberately outside `@alepha/ui` so the
  // design system never depends on a domain. They are declared with
  // `$pageAdmin` (`@alepha/ui/components/admin/admin-router-page`), which
  // parents them onto `AdminRouter`'s shell without this router injecting
  // `AdminRouter` or wiring `parent:` itself.
  protected readonly productApi = $client<AdminProductController>();
  protected readonly orderApi = $client<AdminOrderController>();
  protected readonly shippingApi = $client<AdminShippingController>();

  // ── Storefront ───────────────────────────────────────────────────────

  layout = $page({
    component: Layout,
    children: (): any[] => [
      this.accueil,
      this.atelier,
      this.produit,
      this.pieceRedirect,
      this.panier,
      this.commande,
      this.merci,
      this.account.layout,
    ],
  });

  accueil = $page({
    path: "/",
    head: {
      title: "Atelier Aurore · bijoux façonnés à Paris",
      description:
        "Six pièces d'orfèvrerie faites à la main rue des Orfèvres. Or 18 carats et argent 925.",
    },
    loader: async () => {
      const page = await this.produits.commerceProductList({
        query: { size: 24 },
      });
      // The catalogue sorts by name, so the first row is whatever is
      // alphabetically first — which is not a design decision. The atelier picks
      // which piece opens the page.
      const heroSlug = "collier-aurore";
      return {
        produits: page.content,
        hero: page.content.find((p) => p.slug === heroSlug) ?? page.content[0],
      };
    },
    lazy: () => import("./pages/Accueil.tsx"),
  });

  atelier = $page({
    path: "/atelier",
    head: { title: "L'atelier · Atelier Aurore" },
    lazy: () => import("./pages/Atelier.tsx"),
  });

  produit = $page({
    path: "/produit/:slug",
    // `$page` needs the params schema declared: without it `params` arrives empty
    // and the loader calls the API with `slug: undefined`, which fails deep in
    // the response encoder with a message that names the field but not the cause.
    schema: { params: z.object({ slug: z.text({ minLength: 1 }) }) },
    /*
     * Buffered rather than streamed, so this page can answer 404.
     *
     * A streamed page flushes its `<head>` before the loader runs, so the status
     * is committed before anyone knows whether the piece exists — an unknown slug
     * rendered the error boundary with a 200, which a crawler indexes as a real
     * page. `stream: false` renders to a string first, which lets
     * `onServerResponse` react to what the loader found.
     *
     * Worth the delayed first byte here and nowhere else: this is the only public
     * page whose existence depends on a row.
     */
    stream: false,
    loader: async ({ params }) => {
      try {
        const produit = await this.produits.commerceProductGetBySlug({
          params: { slug: params.slug },
        });
        return { produit, disponible: produit.available };
      } catch (error) {
        // Recorded for `onServerResponse`, which runs after this render and is
        // the only place that can still set the status.
        this.alepha.store.set(produitIntrouvable, true);
        throw error;
      }
    },
    onServerResponse: ({ reply }) => {
      if (this.alepha.store.get(produitIntrouvable)) {
        reply.status = 404;
      }
    },
    // `head` receives the loader's props directly — destructuring `{ props }`
    // silently yields undefined and the page falls back to the default title.
    head: (props: any) => ({
      title: `${props.produit.name} · Atelier Aurore`,
      description: props.produit.description,
    }),
    lazy: () => import("./pages/Produit.tsx"),
  });

  /**
   * The old product URL, kept alive.
   *
   * `/piece/:slug` was the public path until the shop stopped calling its
   * catalogue rows *pièces*. It is live on shop.alepha.dev and indexed, so it
   * redirects rather than 404s.
   *
   * Thrown from the loader rather than declared with `$page`'s `redirect`
   * shorthand, which takes a static string and so cannot carry the slug
   * through. `Redirection` answers **302**; the status is hard-coded in
   * `ReactServerProvider` and the class takes no override. A permanent move
   * deserves a 301, and a crawler keeps re-checking a 302 indefinitely — worth
   * fixing in the framework, but not silently pretended here.
   *
   * `stream: false` because a streamed page commits its status before the
   * loader runs, and this page is nothing but its loader.
   */
  pieceRedirect = $page({
    path: "/piece/:slug",
    schema: { params: z.object({ slug: z.text({ minLength: 1 }) }) },
    stream: false,
    loader: async ({ params }) => {
      throw new Redirection(`/produit/${params.slug}`);
    },
    lazy: () => import("./pages/Produit.tsx"),
  });

  panier = $page({
    path: "/panier",
    head: { title: "Panier · Atelier Aurore" },
    lazy: () => import("./pages/Panier.tsx"),
  });

  commande = $page({
    path: "/commande",
    head: { title: "Commande · Atelier Aurore" },
    lazy: () => import("./pages/Commande.tsx"),
  });

  merci = $page({
    path: "/commande/:sessionId",
    head: { title: "Merci · Atelier Aurore" },
    schema: { params: z.object({ sessionId: z.uuid() }) },
    /*
     * `sessionId` rides along because the page polls itself with it while the
     * payment or the invoice is still in flight, and nothing on the order row
     * points back at the session that produced it.
     */
    loader: async ({ params }) => ({
      ...(await this.checkoutApi.commerceCheckoutOrder({
        params: { id: params.sessionId },
      })),
      sessionId: params.sessionId,
    }),
    lazy: () => import("./pages/Merci.tsx"),
  });

  // ── Sign in ──────────────────────────────────────────────────────────
  //
  // Buying needs no account — every checkout route is open. The account screens
  // exist so a customer can keep an address book and see past orders, and so the
  // back office has a door.
  //
  // They are not declared here: `AuthRouter` from `@alepha/ui` mounts all four
  // of them (`/auth/login`, `/auth/register`, `/auth/reset-password`,
  // `/auth/verify-email`), and `ShopWeb` registers it as a service. The shop
  // used to rebuild three of them by hand under `/compte/*`; that bought French
  // URLs and the atelier's own auth shell at the price of keeping four
  // cross-links correct by hand, and left `/auth/verify-email` missing
  // altogether.

  // ── Back office ──────────────────────────────────────────────────────
  //
  // `AdminRouter` (from `@alepha/ui`) owns the shell and its own ten pages.
  // `$pageAdmin` registers `AdminRouter` and parents each of these three onto
  // its shell in one call — `./index.ts` still lists `AdminRouter` in
  // `services: [...]` too, as the honest declaration of what the app mounts,
  // even though `$pageAdmin` already brings it in.
  //
  // `AdminRouter.layout` carries `use: [$secure({ permissions: ["admin:ui"] })]`,
  // and `ShopRealm` declares `admin:ui` — that is the whole access gate for
  // reaching `/admin/*` at all: an unauthorised visitor is redirected to
  // sign-in (anonymous) or refused with 403 (authenticated) before any child
  // page below renders. Every endpoint underneath keeps its own `$secure`
  // regardless, which is what actually enforces the permission.
  //
  // `can` below is a second, narrower gate: it hides the sidebar entry (and
  // command palette hit) unless the signed-in admin can call the action the
  // page actually loads, closing the gap `admin:ui` alone leaves — a wildcard
  // role holds `admin:ui` whether or not the commerce module is registered.

  adminProduits = $pageAdmin({
    path: "/produits",
    head: { title: "Produits · gestion" },
    nav: {
      label: <Tr k="admin.produits" />,
      icon: <Gem />,
      group: "Commerce",
      order: 100,
    },
    can: () => this.productApi.commerceAdminProductList.can(),
    lazy: () => import("./pages/admin/AdminProduits.tsx"),
  });

  /**
   * One product, on its own page.
   *
   * No `nav` — reached from the catalogue, not from the sidebar.
   *
   * The route lives here rather than in `@alepha/commerce`, which registers no
   * pages at all: the package ships the component and the application decides
   * where it hangs. That is also why the list is handed `detailPath` — it has
   * to build a link to a path only this file knows.
   *
   * `productId` is unique across the whole route table on purpose. Two routes
   * declaring different param names at the same position silently lose the
   * inner value.
   */
  adminProduitDetail = $pageAdmin({
    path: "/produits/:productId",
    head: { title: "Produit · gestion" },
    schema: { params: z.object({ productId: z.uuid() }) },
    can: () => this.productApi.commerceAdminProductGet.can(),
    lazy: () => import("./pages/admin/AdminProduitDetail.tsx"),
  });

  adminCommandes = $pageAdmin({
    path: "/commandes",
    head: { title: "Commandes · gestion" },
    nav: {
      label: <Tr k="admin.orders" />,
      icon: <Package />,
      group: "Commerce",
      order: 101,
    },
    can: () => this.orderApi.commerceAdminOrderList.can(),
    lazy: () => import("./pages/admin/AdminCommandes.tsx"),
  });

  adminLivraison = $pageAdmin({
    path: "/livraison",
    head: { title: "Livraison · gestion" },
    nav: {
      label: <Tr k="admin.shipping" />,
      icon: <Truck />,
      group: "Commerce",
      order: 102,
    },
    can: () => this.shippingApi.commerceAdminShippingRates.can(),
    lazy: () => import("./pages/admin/AdminLivraison.tsx"),
  });
}
