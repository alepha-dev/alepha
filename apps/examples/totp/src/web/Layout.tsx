import { ButtonTheme } from "@alepha/ui/components/button-theme/button-theme";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { Link, NestedView } from "alepha/react/router";
import { ShieldCheck } from "lucide-react";

/**
 * The application shell: a header, the page, and nothing else.
 *
 * ⚠️ `DialogProvider` is not optional decoration. `@alepha/ui`'s account pages
 * call `useDialog()` to confirm destructive actions, and turning off the second
 * factor asks for a code through `dialog.prompt`. Without this provider mounted
 * above them, `useDialog` throws and the security page dies on render.
 *
 * `Toaster` is the same kind of dependency: those pages report success and
 * failure through `useToast`, so without it every outcome is silent.
 */
export const Layout = () => {
  return (
    <TooltipProvider>
      <DialogProvider>
        <div className="flex min-h-dvh flex-col">
          <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-5 py-4">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="size-5" />
                <span>TOTP demo</span>
              </Link>

              <div className="ml-auto flex items-center gap-2">
                <ButtonTheme />
                {/*
                 * Resolves the signed-in account and links to `/account`. It is
                 * also the sign-in entry point when nobody is signed in, which
                 * is why the shell needs no `/auth/login` link of its own.
                 */}
                <ButtonUser />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">
            <NestedView />
          </main>

          <footer className="text-muted-foreground mx-auto w-full max-w-4xl px-5 py-8 text-sm">
            An Alepha example. Everything here is a realm setting, not
            application code.
          </footer>
        </div>
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};
