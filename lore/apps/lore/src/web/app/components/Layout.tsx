import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import Header from "./shared/header/Header.tsx";

const Layout = () => {
  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <div className="flex h-screen flex-col">
          <Header />
          <div className="flex flex-1 flex-col overflow-auto">
            <NestedView />
          </div>
        </div>
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default Layout;
