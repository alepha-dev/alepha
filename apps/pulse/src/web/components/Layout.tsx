import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView, useRouter } from "alepha/react/router";
import { Activity } from "lucide-react";

/**
 * Shell for every page.
 *
 * `DialogProvider` is mounted here because revoking an app's key confirms
 * through `useDialog()`; native `window.confirm` is banned.
 */
const Layout = () => {
  const router = useRouter();

  return (
    <DialogProvider>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
            <button
              type="button"
              className="flex items-center gap-2"
              onClick={() => void router.push("home")}
            >
              <Activity className="size-5 text-primary" />
              <span className="font-semibold">Pulse</span>
            </button>
            <span className="text-sm text-muted-foreground">
              Analytics, errors and web vitals
            </span>
            <div className="ml-auto">
              <ButtonUser onSignIn={() => router.push("/auth/login")}>
                <ButtonUser.Email />
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
