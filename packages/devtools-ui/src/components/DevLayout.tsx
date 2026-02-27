import {
  ActionButton,
  DarkModeButton,
  DashboardShell,
  Flex,
  OmnibarButton,
} from "@alepha/ui";
import {
  IconArrowLeft,
  IconDashboard,
  IconDatabase,
  IconList,
  IconSettings,
  IconSitemap,
  IconTopologyRing,
} from "@tabler/icons-react";
import { devMetadataSchema } from "alepha/devtools";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";

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
      layout={"alt"}
      appShellMainProps={{
        style: {
          display: "flex",
          flexDirection: "column",
        },
      }}
      footer={<Flex />}
      navbarFooter={<Flex />}
      footerHeight={24}
      headerHeight={60}
      navbarHeader={() => (
        <Flex align="center" justify="center" h="100%" w="100%">
          <ActionButton
            href="/"
            target="_self"
            variant="subtle"
            color="gray"
            size="sm"
          >
            <IconArrowLeft size={18} />
          </ActionButton>
        </Flex>
      )}
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
