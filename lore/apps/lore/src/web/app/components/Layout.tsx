import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";

const Layout = () => {
  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <div className="flex h-svh flex-col overflow-hidden">
          <NestedView />
        </div>
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default Layout;
