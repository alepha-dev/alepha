import { ClientOnly, useRouter, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import {
  AdminShell,
  AlephaMantineProvider,
  type SidebarNode,
} from "@alepha/ui";
import type { AdminShellProps } from "@alepha/ui/src/components/layout/AdminShell.tsx";
import { ui } from "@alepha/ui/src/constants/ui.ts";
import { Flex, Text } from "@mantine/core";
import {
  IconHeartHandshake,
  IconMap2,
  IconPackage,
  IconRobot,
} from "@tabler/icons-react";
import { docs } from "../config/docs.ts";
import Header from "./Header.tsx";

const Layout = () => {
  return (
    <AlephaMantineProvider
      mantine={{ defaultColorScheme: "dark" }}
      colorSchemeScript={{ defaultColorScheme: "dark" }}
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

  const sidebarMenu: SidebarNode[] = [
    {
      label: "Guides",
      icon: <IconMap2 />,
      children: docs
        .filter((it) => it.category === "guides")
        .map((doc) => ({
          label: (
            <Text size={"sm"}>
              {doc.name
                .replace("@", "")
                .replaceAll("-", "/")
                .replace("Alepha", "")}
            </Text>
          ),
          href: `/docs/${doc.slug}`,
        })),
    },
    {
      label: "Core Concepts",
      icon: <IconHeartHandshake />,
      children: docs
        .filter((it) => it.category === "concepts")
        .map((doc) => ({
          label: (
            <Text size={"sm"}>
              {doc.name
                .replace("@", "")
                .replaceAll("-", "/")
                .replace("Alepha", "")}
            </Text>
          ),
          href: `/docs/${doc.slug}`,
        })),
    },
    {
      label: "Packages",
      icon: <IconPackage />,
      children: docs
        .filter((it) => it.category === "packages")
        .map((doc) => ({
          label: (
            <Text size={"sm"} fw={"light"}>
              {doc.name
                .replace("@", "")
                .replaceAll("-", "/")
                .replace("Alepha", "")}
            </Text>
          ),
          href: `/docs/${doc.slug}`,
        })),
    },
    {
      label: "LLM",
      position: "bottom",
      icon: <IconRobot />,
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

  const header = <Header />;

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
      bg: ui.colors.transparent,
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
