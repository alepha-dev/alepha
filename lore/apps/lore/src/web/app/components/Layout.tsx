import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { useI18n } from "alepha/react/i18n";
import { NestedView } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import { useEffect } from "react";

import Spotlight from "./shared/spotlight/Spotlight.tsx";

const Layout = () => {
  const { lang } = useI18n();

  // Keep <html lang> in sync with the active locale (driven by the URL prefix).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <div className="flex h-svh flex-col overflow-hidden">
          <NestedView />
        </div>
        {/* App-wide so ⌘K works from any page, not just the ones that
            happen to render a header. */}
        <Spotlight />
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default Layout;
