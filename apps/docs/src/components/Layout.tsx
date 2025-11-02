import { NestedView, useEvents, useRouterState } from "@alepha/react";
import {
  AppShell,
  ColorSchemeScript,
  Flex,
  MantineProvider,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { theme } from "../config/theme.ts";
import Header from "./Header.tsx";
import Sidebar from "./Sidebar.tsx";

const Layout = () => {
  useEvents(
    {
      "react:transition:begin": () => {
        nprogress.start();
      },
      "react:transition:end": () => {
        nprogress.complete();
      },
    },
    [],
  );

  return (
    <>
      <ColorSchemeScript defaultColorScheme="dark" />
      <MantineProvider defaultColorScheme="dark" theme={theme.mantine}>
        <NavigationProgress />
        <LayoutContent />
      </MantineProvider>
    </>
  );
};

export default Layout;

const LayoutContent = () => {
  const [opened, { toggle }] = useDisclosure();
  const router = useRouterState();
  const noSidebar = router.layers.slice(-1)[0]?.route?.sidebar !== true;

  const header = (
    <AppShell.Header>
      <Header opened={opened} toggle={toggle} withBurger={!noSidebar} />
    </AppShell.Header>
  );

  const footer = (
    <AppShell.Footer>
      <Flex justify={"space-between"} align={"center"} h={"100%"} px={"xs"}>
        <Flex flex={1} justify={"flex-start"}>
          <Text size={"xs"} c={"dimmed"}>
            Alepha Docs
          </Text>
        </Flex>
        <Flex justify={"flex-end"}>
          <Text size={"xs"} c={"dimmed"}>
            {`Last update - ${import.meta.env.VITE_BUILD_DATE.split("T")[0]}`}
          </Text>
        </Flex>
      </Flex>
    </AppShell.Footer>
  );

  if (noSidebar) {
    return (
      <AppShell
        padding="md"
        withBorder={false}
        header={{ height: theme.headerHeight }}
        footer={{ height: theme.footerHeight }}
      >
        {header}
        <AppShell.Main mih={"auto"}>
          <NestedView />
        </AppShell.Main>
        {footer}
      </AppShell>
    );
  }

  return (
    <AppShell
      padding="md"
      withBorder={false}
      header={{ height: theme.headerHeight }}
      footer={{ height: theme.footerHeight }}
      navbar={{
        width: theme.sidebarWidth,
        breakpoint: theme.sidebarBreakpoint,
        collapsed: { mobile: !opened },
      }}
    >
      {header}
      <AppShell.Navbar>
        <Sidebar toggle={toggle} />
      </AppShell.Navbar>
      <AppShell.Main mih={"auto"}>
        <NestedView />
      </AppShell.Main>
      {footer}
    </AppShell>
  );
};
