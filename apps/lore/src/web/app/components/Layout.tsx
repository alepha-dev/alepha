import { NavigationProgress } from "@alepha/ui/components/app-shell/navigation-progress";
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
        {/* Mounted here rather than in `AppShell`, which is where it used to
            live and only ever covered navigations that both started and ended
            inside a project. The bar is driven by router events, so it can
            only draw for a transition it is already mounted for: leaving the
            landing page had no bar because the landing page has no shell, and
            arriving at a project had none either because the shell that owned
            the bar was itself part of the page being committed. At the root of
            the layout it outlives every transition the app can make.
            `ProjectView` passes `progress={false}` so there is exactly one. */}
        <NavigationProgress />
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
