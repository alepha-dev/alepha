import { DialogProvider, Toaster, TooltipProvider } from "@alepha/ui";
import { NestedView } from "alepha/react/router";

/**
 * The shell: a header and the page.
 */
export const Layout = () => {
  return (
    <TooltipProvider>
      <DialogProvider>
        <div className="flex min-h-dvh flex-col">
          <header className="border-b">
            <div className="mx-auto w-full max-w-3xl px-5 py-4 font-semibold">
              Notes, with an assistant
            </div>
          </header>
          <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
            <NestedView />
          </main>
        </div>
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};
