import { AppShell } from "@alepha/ui/components/app-shell";
import { ThemeToggle } from "@alepha/ui/components/theme-toggle";
import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog";
import { useInject } from "alepha/react";
import { NestedView, useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import { HttpClient } from "alepha/server";
import {
  Database,
  LayoutDashboard,
  List,
  Mail,
  MessageSquare,
  Network,
  Settings,
  Workflow,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { devMetadataSchema } from "../../schemas/DevMetadata.ts";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const DevLayout = () => {
  const http = useInject(HttpClient);
  const state = useRouterState();
  const [entityCount, setEntityCount] = useState<number | null>(null);

  const fetchMetadata = useCallback(async () => {
    try {
      const res = await http.fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      });
      setEntityCount(res.data.entities?.length ?? 0);
    } catch {
      // silently fail
    }
  }, [http]);

  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);

  const navGroups: NavGroup[] = useMemo(() => {
    const overview: NavItem[] = [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/explorer", label: "Explorer", icon: Workflow },
    ];

    if (entityCount === null || entityCount > 0) {
      overview.push({ href: "/db/erd", label: "Database", icon: Database });
    }

    overview.push({
      href: "/conf/env",
      label: "Configuration",
      icon: Settings,
    });

    return [
      { items: overview },
      {
        label: "Messaging",
        items: [
          { href: "/emails", label: "Emails", icon: Mail },
          { href: "/sms", label: "SMS", icon: MessageSquare },
        ],
      },
      {
        label: "Diagnostics",
        items: [
          { href: "/graph", label: "Graph", icon: Network },
          { href: "/logs", label: "Logs", icon: List },
        ],
      },
    ];
  }, [entityCount]);

  return (
    <TooltipProvider>
      <DialogProvider>
        <ColorScheme />
        <AppShell
          topbarActions={<ThemeToggle />}
          brand={
            <div className="flex items-center gap-2 px-2 py-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded">
                α
              </span>
              <span className="truncate group-data-[collapsible=icon]:hidden">
                Alepha Devtools
              </span>
            </div>
          }
          nav={navGroups.map((group) => ({
            label: group.label,
            items: group.items.map((it) => ({
              href: it.href,
              label: it.label,
              icon: it.icon,
              active: state.url.pathname.startsWith(
                it.href.split("/")[1] ? it.href : "/",
              ),
            })),
          }))}
        >
          <NestedView />
        </AppShell>
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default DevLayout;
