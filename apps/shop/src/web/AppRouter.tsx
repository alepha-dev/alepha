import type { ProductController } from "@alepha/commerce";
import type { CheckoutController } from "@alepha/commerce/checkout";
import { $atom, $inject, Alepha, z } from "alepha";
import { $page, Redirection } from "alepha/react/router";
import { $client } from "alepha/server/links";
import { AdminLayout } from "./AdminLayout.tsx";
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
 * Set by the piece loader when the slug matches nothing, read by that page's
 * `onServerResponse` to answer 404.
 *
 * An atom rather than a field on the router, because the store is per-request on
 * the server: a field would leak one visitor's missing piece into the next
 * visitor's response.
 */
const pieceIntrouvable = $atom({
  name: "shop.pieceIntrouvable",
  schema: z.boolean(),
  default: false,
});

export class AppRouter {
  protected readonly alepha = $inject(Alepha);
  protected readonly produits = $client<ProductController>();
  protected readonly checkoutApi = $client<CheckoutController>();

  // ── Storefront ───────────────────────────────────────────────────────

  layout = $page({
    component: Layout,
    children: (): any[] => [
      this.accueil,
      this.atelier,
      this.piece,
      this.panier,
      this.commande,
      this.merci,
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
        pieces: page.content,
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

  piece = $page({
    path: "/piece/:slug",
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
        const piece = await this.produits.commerceProductGetBySlug({
          params: { slug: params.slug },
        });
        return { piece, disponible: piece.available };
      } catch (error) {
        // Recorded for `onServerResponse`, which runs after this render and is
        // the only place that can still set the status.
        this.alepha.store.set(pieceIntrouvable, true);
        throw error;
      }
    },
    onServerResponse: ({ reply }) => {
      if (this.alepha.store.get(pieceIntrouvable)) {
        reply.status = 404;
      }
    },
    // `head` receives the loader's props directly — destructuring `{ props }`
    // silently yields undefined and the page falls back to the default title.
    head: (props: any) => ({
      title: `${props.piece.name} · Atelier Aurore`,
      description: props.piece.description,
    }),
    lazy: () => import("./pages/Piece.tsx"),
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
    loader: async ({ params }) =>
      this.checkoutApi.commerceCheckoutOrder({
        params: { id: params.sessionId },
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

  adminLayout = $page({
    path: "/admin",
    component: AdminLayout,
    /*
     * ### Why a loader and not `$secure`
     *
     * The first version wrote `use: [$secure({ permissions: ["admin:ui"] })]`
     * here and a comment claiming an unauthorised visitor would be redirected.
     * It is not: in the browser `$secure` short-circuits by returning
     * `undefined`, so the *loader* never runs and the page renders anyway. An
     * anonymous visitor typing `/admin/pieces` got the whole back-office shell,
     * sidebar and all, with empty tables behind it — every request underneath
     * answering 401. The e2e suite is what caught it.
     *
     * So the redirect lives in the loader, the way `apps/lore` does it: throw
     * `Redirection` and the router follows it on the server and in the browser
     * alike. `?redirect=` carries the intended page so signing in lands where
     * the visitor was going.
     *
     * This is a UI guard, not an authorisation. Every endpoint underneath keeps
     * its own `$secure` — that is what actually enforces the permission, and it
     * answers 401 whatever the interface does.
     */
    loader: async ({ user }) => {
      if (!user?.roles?.includes("admin")) {
        throw new Redirection(
          `/auth/login?redirect=${encodeURIComponent("/admin/pieces")}`,
        );
      }
    },
    children: (): any[] => [
      this.adminPieces,
      this.adminCommandes,
      this.adminLivraison,
    ],
  });

  adminPieces = $page({
    path: "/pieces",
    head: { title: "Pièces · gestion" },
    lazy: () => import("./pages/admin/AdminPieces.tsx"),
  });

  adminCommandes = $page({
    path: "/commandes",
    head: { title: "Commandes · gestion" },
    lazy: () => import("./pages/admin/AdminCommandes.tsx"),
  });

  adminLivraison = $page({
    path: "/livraison",
    head: { title: "Livraison · gestion" },
    lazy: () => import("./pages/admin/AdminLivraison.tsx"),
  });
}
