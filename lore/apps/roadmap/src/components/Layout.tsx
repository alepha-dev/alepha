import { Alepha } from "@alepha/core";
import { NestedView, useEvents, useInject } from "@alepha/react";
import { ColorSchemeScript, Flex, MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { theme } from "../constants/theme.ts";
import Header from "./shared/Header.jsx";

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

  const alepha = useInject(Alepha);

  return (
    <>
      {alepha.isProduction() && <Analytics />}
      {alepha.isProduction() && <SpeedInsights />}
      <ColorSchemeScript defaultColorScheme={theme.defaultColorScheme} />
      <MantineProvider
        defaultColorScheme={theme.defaultColorScheme}
        theme={theme.mantine}
      >
        <Notifications />
        <NavigationProgress />
        <ModalsProvider>
          <Flex className={"root"}>
            <Header />
            <NestedView />
          </Flex>
        </ModalsProvider>
      </MantineProvider>
    </>
  );
};

export default Layout;
