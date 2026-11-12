import { Toaster, TooltipProvider, DialogProvider } from "@alepha/ui";
import { AiChatDockSlot } from "@alepha/ui/ai";
import { ActionErrorToaster, NavigationProgress } from "@alepha/ui/shell";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import { useEffect } from "react";

import { ShellExtensionRegistry } from "../registries/ShellExtensionRegistry.ts";
import Spotlight from "./shared/spotlight/Spotlight.tsx";

const Layout = () => {
  const { lang } = useI18n();
  const overlays = useInject(ShellExtensionRegistry).overlays();

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
        {/* A row: the page, and beside it the framework's dock slot, where a
            docked panel (the app's assistant, through an overlay below) takes
            its width from the page rather than covering it. Empty, the slot
            takes none. The slot is `bg-sidebar`, the frame the project's
            inset shell draws around its page, so the dock sits in the same
            frame instead of on the body's colour (#Q3372). */}
        <div className="flex h-svh overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <NestedView />
          </div>
          <AiChatDockSlot className="bg-sidebar" />
        </div>
        {/* What the app adds at the root (`ShellExtensionRegistry`), mounted
            once so it outlives every page. Core names none of them. */}
        {overlays.map((entry) => (
          <entry.component key={entry.key} />
        ))}
        {/* App-wide so ⌘K works from any page, not just the ones that
            happen to render a header. */}
        <Spotlight />
        <Toaster />
        {/* The one listener that turns a failed `useAction`, `useQuery`,
            `useForm` or table load into a toast, on every page. Lore had
            none: `ProjectView`'s `AppShell` is `embedded`, and an embedded
            shell mounts no toaster of its own, so a managed request failed
            in silence even inside a project, and everywhere else
            (`/new-project`, the landing page) too. A call site
            that shows its own error passes `onError`, which marks the
            failure handled and keeps it out of here. `/admin` is not under
            this layout: its `NavShell` mounts its own. */}
        <ActionErrorToaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default Layout;
