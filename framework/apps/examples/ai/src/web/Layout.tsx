import { DialogProvider, Toaster, TooltipProvider } from "@alepha/ui";
import { AiChatDockSlot } from "@alepha/ui/ai";
import { NestedView } from "alepha/react/router";

/**
 * The shell: a header and the page, and a column beside them where the
 * assistant docks.
 */
export const Layout = () => {
  return (
    <TooltipProvider>
      <DialogProvider>
        <div className="flex min-h-dvh">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="border-b">
              <div className="mx-auto w-full max-w-3xl px-5 py-4 font-semibold">
                Notes, with an assistant
              </div>
            </header>
            <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
              <NestedView />
            </main>
          </div>
          <AiChatDockSlot />
        </div>
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};
