import { Toaster, TooltipProvider, DialogProvider } from "@alepha/ui";
import {
  ActionErrorToaster,
  ButtonLanguage,
  ButtonTheme,
  ButtonUser,
} from "@alepha/ui/shell";
import { useI18n } from "alepha/react/i18n";
import { Link, NestedView, useRouter } from "alepha/react/router";

import type { AppRouter } from "./AppRouter.tsx";
import { Poincon } from "./components/Poincon.tsx";
import { useChargementPanier } from "./hooks/useChargementPanier.ts";
import { usePanier } from "./hooks/usePanier.ts";

/**
 * The storefront shell.
 *
 * Header, page, footer — nothing more. A sidebar or a mega-menu would be a
 * software convention imposed on a catalogue of six pieces; the shop is small
 * enough that its navigation fits on one line, and pretending otherwise would be
 * the first thing that made it look generic.
 */
export const Layout = () => {
  const { compte } = usePanier();
  const { tr } = useI18n();
  const router = useRouter<AppRouter>();

  useChargementPanier();

  return (
    <TooltipProvider>
      <DialogProvider>
        <div className="flex min-h-dvh flex-col">
          <header className="trait bg-background/85 sticky top-0 z-40 border-t-0 border-b backdrop-blur-sm">
            {/*
              Tighter gaps below `sm`. At 375px the mark, three nav links and
              three utility buttons came to 400px wide, so the whole page
              scrolled sideways — the one thing a phone layout must never do.
              The desktop spacing is unchanged; only the gutters give way, which
              is the cheapest thing in the header to spend.
            */}
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-4 sm:gap-6">
              <Link
                href="/"
                className="flex items-center gap-3"
                aria-label={tr("nav.home")}
              >
                <Poincon titre="AA" />
                <span className="estampe hidden text-sm sm:block">
                  Atelier Aurore
                </span>
              </Link>

              <nav className="mesure ml-auto flex items-center gap-3 sm:gap-5">
                <Link
                  href="/"
                  className="hover:text-foreground text-muted-foreground transition-colors"
                >
                  {tr("nav.produits")}
                </Link>
                <Link
                  href="/atelier"
                  className="hover:text-foreground text-muted-foreground transition-colors"
                >
                  {tr("nav.atelier")}
                </Link>
                <Link
                  href="/panier"
                  className="hover:text-foreground text-muted-foreground flex items-center gap-1.5 transition-colors"
                >
                  {tr("nav.panier")}
                  {compte > 0 ? (
                    <span
                      className="bg-primary text-primary-foreground inline-flex h-4 min-w-4 items-center justify-center px-1 text-[0.625rem]"
                      aria-label={tr("nav.cartCount", {
                        args: [String(compte)],
                      })}
                    >
                      {compte}
                    </span>
                  ) : null}
                </Link>
              </nav>

              <div className="flex items-center gap-1">
                <ButtonLanguage />
                <ButtonTheme />
                {/*
                  `ButtonUser` needs its callbacks: it disables the sign-in icon
                  when `onSignIn` is absent and hides the admin entry when
                  `onAdminClick` is, so a bare `<ButtonUser />` renders a greyed
                  button that looks broken and gives an administrator no way in.
                  The labels default to English, which is why they must be passed
                  too — a prop default is invisible to the i18n catalogue.
                */}
                <ButtonUser
                  onSignIn={() => router.push("login")}
                  onAdminClick={() => router.push("adminProduits")}
                  signInLabel={tr("nav.signIn")}
                  menuLabel={tr("nav.account")}
                />
              </div>
            </div>
          </header>

          <main className="flex-1">
            <NestedView />
          </main>

          <footer className="trait mt-24 border-t">
            <div className="mesure text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
              <p>{tr("footer.legal")}</p>
              <p>{tr("footer.demo")}</p>
            </div>
          </footer>
        </div>
        <Toaster />
        {/* The one listener that turns a failed request into a toast. The
            storefront had none, so a cart write or a checkout step that the
            server refused did nothing visible; the admin had its own, inside
            its `AppShell`. A place that shows its own error passes
            `onError`, which keeps it out of here. */}
        <ActionErrorToaster />
      </DialogProvider>
    </TooltipProvider>
  );
};
