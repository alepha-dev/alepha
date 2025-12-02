import { ClientOnly, useRouter, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import type { AdminShellProps } from "@alepha/ui";
import {
  AdminShell,
  AlephaMantineProvider,
  type SidebarMenuItem,
  type SidebarNode,
  ui,
} from "@alepha/ui";
import { Flex, Text } from "@mantine/core";
import { type DocNode, tree } from "../config/docs.ts";
import Header from "./Header.tsx";

const Layout = () => {
  return (
    <AlephaMantineProvider
      mantine={{
        theme: {
          primaryColor: "gray",
          primaryShade: {
            light: 8,
            dark: 9,
          },
        },
      }}
    >
      <LayoutContent />
    </AlephaMantineProvider>
  );
};

export default Layout;

const LayoutContent = () => {
  const { layers } = useRouterState();
  const noSidebar = layers.slice(-1)[0]?.route?.sidebar !== true;
  const router = useRouter();
  const { l } = useI18n();

  const convertTreeToSidebar = (nodes: DocNode[]): SidebarMenuItem[] => {
    return nodes.map((node) => {
      const sidebarNode: SidebarMenuItem = {
        label: (
          <Text
            size={"sm"}
            fw={node.children && node.children.length > 0 ? "bold" : "normal"}
          >
            {node.name}
          </Text>
        ),
      };

      if (node.href) {
        sidebarNode.href = node.href;
      }

      if (node.children && node.children.length > 0) {
        sidebarNode.children = convertTreeToSidebar(node.children);
      }

      return sidebarNode;
    });
  };

  const sidebarMenu: SidebarNode[] = [
    ...convertTreeToSidebar(tree),
    {
      label: "LLM",
      position: "bottom",
      target: "_self",
      href: router.base("/llms.txt"),
    },
  ];

  const footer = (
    <Flex justify={"space-between"} align={"center"} h={"100%"} px={"md"}>
      <Flex flex={1} justify={"flex-start"}>
        <Text size={"xs"} c={"dimmed"}>
          alepha.dev documentation
        </Text>
      </Flex>
      <Flex justify={"flex-end"}>
        <Text size={"xs"} c={"dimmed"}>
          {"updated "}
          <ClientOnly>
            {l(import.meta.env.VITE_BUILD_DATE.split("T")[0], {
              date: "fromNow",
            })}
          </ClientOnly>
        </Text>
      </Flex>
    </Flex>
  );

  const header = <Header noSidebar={noSidebar} />;

  const adminShellProps: AdminShellProps = {
    appShellProps: {
      withBorder: false,
      padding: "md",
      footer: { height: 32 },
    },
    appShellFooterProps: {
      bg: ui.colors.transparent,
      style: {
        backdropFilter: "blur(10px)",
      },
    },
    appShellNavbarProps: {
      bg: ui.colors.background,
    },
    appShellHeaderProps: {
      bg: ui.colors.transparent,
      style: {
        backdropFilter: "blur(20px)",
      },
    },
    sidebarProps: {
      menu: sidebarMenu,
    },
    header: header,
    footer: footer,
  };

  if (noSidebar) {
    return (
      <AdminShell
        {...adminShellProps}
        sidebarProps={undefined}
        footer={undefined}
      />
    );
  }

  return <AdminShell {...adminShellProps} />;
};
