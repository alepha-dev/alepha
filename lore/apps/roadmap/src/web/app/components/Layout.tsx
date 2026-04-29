import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { ConfirmProvider } from "@alepha/ui/components/use-confirm";
import { NestedView } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import Header from "./shared/header/Header.tsx";

const Layout = () => {
  return (
    <TooltipProvider>
      <ConfirmProvider>
        <ColorScheme />
        <div className="flex h-screen flex-col">
          <Header />
          <div className="flex flex-1 flex-col overflow-auto">
            <NestedView />
          </div>
        </div>
        <Toaster />
      </ConfirmProvider>
    </TooltipProvider>
  );
};

export default Layout;
