import type { ProductController } from "@alepha/commerce";
import type { CheckoutController } from "@alepha/commerce/checkout";
import { z } from "alepha";
import type { RealmController } from "alepha/api/users";
import { $page, Redirection } from "alepha/react/router";
import { $client } from "alepha/server/links";
import { AdminLayout } from "./AdminLayout.tsx";
import { AuthLayout } from "./AuthLayout.tsx";
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
export class AppRouter {
  protected readonly produits = $client<ProductController>();
  protected readonly checkoutApi = $client<CheckoutController>();
  protected readonly realmApi = $client<RealmController>();

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
    loader: async ({ params }) => {
      const piece = await this.produits.commerceProductGetBySlug({
        params: { slug: params.slug },
      });
      return { piece, disponible: piece.available };
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
  // Buying needs no account — every checkout route is open. These exist so a
  // customer can keep an address book and see past orders, and so the back
  // office has a door.

  authLayout = $page({
    path: "/compte",
    component: AuthLayout,
    children: (): any[] => [this.connexion, this.inscription, this.motDePasse],
  });

  connexion = $page({
    path: "/connexion",
    // Named so `ButtonUser` and the `$secure` redirect can find it.
    name: "login",
    head: { title: "Connexion · Atelier Aurore" },
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
    lazy: () => import("./pages/auth/Connexion.tsx"),
  });

  inscription = $page({
    path: "/inscription",
    name: "register",
    head: { title: "Créer un compte · Atelier Aurore" },
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
    lazy: () => import("./pages/auth/Inscription.tsx"),
  });

  motDePasse = $page({
    path: "/mot-de-passe",
    head: { title: "Mot de passe oublié · Atelier Aurore" },
    loader: async () => ({
      realmConfig: await this.realmApi.getRealmConfig(),
    }),
    lazy: () => import("./pages/auth/MotDePasse.tsx"),
  });

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
          `/compte/connexion?redirect=${encodeURIComponent("/admin/pieces")}`,
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
