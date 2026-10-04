import { DialogProvider, Toaster } from "@alepha/ui";
import { ActionErrorToaster, ButtonUser } from "@alepha/ui/shell";
import { Link, NestedView } from "alepha/react/router";

/**
 * Header and page. The dialog provider is what the notes page's delete
 * confirmation opens in, and the error toaster reports any failed call.
 */
export const Layout = () => {
  return (
    <DialogProvider>
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center gap-4 border-b px-4 py-3">
          <Link href="/" className="font-semibold">
            Mobile
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/notes">Notes</Link>
          </nav>
          <div className="ml-auto">
            <ButtonUser />
          </div>
        </header>
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
          <NestedView />
        </main>
      </div>
      <Toaster />
      <ActionErrorToaster />
    </DialogProvider>
  );
};
