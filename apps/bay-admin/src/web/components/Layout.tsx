import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { DropdownMenuItem } from "@alepha/ui/components/ui/dropdown-menu";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView, useRouter } from "alepha/react/router";
import { Anchor, UserCog } from "lucide-react";

/**
 * Shell for every page — a title bar and the outlet, nothing else.
 *
 * `DialogProvider` is mounted here because destructive actions (stop, restore)
 * confirm through `useDialog()`; native `window.confirm` is banned.
 *
 * The account button is not decoration: every page here is admin-only and the
 * session is the whole authorization, so leaving one open on a shared screen
 * with no way to close it is the panel's own security model working against the
 * operator.
 */
const Layout = () => {
  const router = useRouter();

  return (
    <DialogProvider>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
            <Anchor className="size-5 text-primary" />
            <span className="font-semibold">Bay</span>
            <span className="text-sm text-muted-foreground">
              Alepha application server
            </span>
            <div className="ml-auto">
              {/*
                Custom menu because the default one leads with an email, and
                this realm has none. Profile is the only destination worth
                offering: it is where the bootstrap password gets replaced.
              */}
              <ButtonUser onSignIn={() => router.push("/auth/login")}>
                <ButtonUser.Email />
                <DropdownMenuItem onClick={() => router.push("profile")}>
                  <UserCog className="size-4" />
                  Profile
                </DropdownMenuItem>
                <ButtonUser.LogoutMenuItem />
              </ButtonUser>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">
          <NestedView />
        </main>
      </div>
    </DialogProvider>
  );
};

export default Layout;
