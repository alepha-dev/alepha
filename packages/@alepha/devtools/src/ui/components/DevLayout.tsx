import {
  DarkModeButton,
  DashboardShell,
  Flex,
  OmnibarButton,
} from "@alepha/mantine";
import {
  IconDashboard,
  IconDatabase,
  IconList,
  IconMail,
  IconMessage,
  IconSettings,
  IconSitemap,
  IconTopologyRing,
} from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { devMetadataSchema } from "../../schemas/DevMetadata.ts";

export const DevLayout = () => {
  const http = useInject(HttpClient);
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

  const sidebarItems = useMemo(() => {
    const items: any[] = [
      {
        label: "Dashboard",
        icon: <IconDashboard />,
        href: "/",
      },
      { type: "divider" },
      {
        label: "Explorer",
        icon: <IconSitemap />,
        href: "/explorer",
      },
    ];

    if (entityCount === null || entityCount > 0) {
      items.push({
        label: "Database",
        icon: <IconDatabase />,
        href: "/db/erd",
      });
    }

    items.push(
      {
        label: "Configuration",
        icon: <IconSettings />,
        href: "/conf/env",
      },
      { type: "divider" },
      {
        label: "Emails",
        icon: <IconMail />,
        href: "/emails",
      },
      {
        label: "SMS",
        icon: <IconMessage />,
        href: "/sms",
      },
      { type: "divider" },
      {
        label: "Graph",
        icon: <IconTopologyRing />,
        href: "/graph",
      },
      {
        label: "Logs",
        icon: <IconList />,
        href: "/logs",
      },
    );

    return items;
  }, [entityCount]);

  return (
    <DashboardShell
      appShellMainProps={{
        style: {
          display: "flex",
          flexDirection: "column",
        },
      }}
      footer={<Flex />}
      sidebarProps={{
        collapsed: true,
        items: sidebarItems,
      }}
      appBarProps={{
        items: [
          { position: "left", type: "burger" },
          {
            position: "left",
            element: (
              <OmnibarButton
                actionProps={{
                  variant: "outline",
                  bd: "1px solid var(--mantine-color-default-border)",
                }}
              />
            ),
          },
          {
            position: "right",
            element: <DarkModeButton />,
          },
        ],
      }}
    />
  );
};

export default DevLayout;
