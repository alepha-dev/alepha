import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView } from "alepha/react/router";
import { Anchor } from "lucide-react";

/**
 * Shell for every page — a title bar and the outlet, nothing else.
 *
 * `DialogProvider` is mounted here because destructive actions (stop, restore)
 * confirm through `useDialog()`; native `window.confirm` is banned.
 */
const Layout = () => {
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
