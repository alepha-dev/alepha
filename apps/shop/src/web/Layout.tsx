import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { useI18n } from "alepha/react/i18n";
import { Link, NestedView, useRouter } from "alepha/react/router";
import { useEffect } from "react";
import type { AppRouter } from "./AppRouter.tsx";
import { Poincon } from "./components/Poincon.tsx";
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
  const { compte, refresh } = usePanier();
  const { tr } = useI18n();
  const router = useRouter<AppRouter>();

  // The cart lives in a signed cookie, so the browser only learns what is in it
  // by asking. Once, on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <TooltipProvider>
      <DialogProvider>
        <div className="flex min-h-dvh flex-col">
          <header className="trait border-t-0 border-b sticky top-0 z-40 backdrop-blur-sm bg-background/85">
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
                <span className="estampe text-sm hidden sm:block">
                  Atelier Aurore
                </span>
              </Link>

              <nav className="mesure ml-auto flex items-center gap-3 sm:gap-5">
                <Link
                  href="/"
                  className="hover:text-foreground text-muted-foreground transition-colors"
                >
                  {tr("nav.pieces")}
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
                  onAdminClick={() => router.push("adminPieces")}
                  signInLabel={String(tr("nav.signIn"))}
                  menuLabel={String(tr("nav.account"))}
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
      </DialogProvider>
    </TooltipProvider>
  );
};
