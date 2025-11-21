import { NestedView, useInject } from "@alepha/react";
import { AlephaMantineProvider } from "@alepha/ui";
import { Flex } from "@mantine/core";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Alepha } from "alepha";
import { theme } from "../constants/theme.ts";
import Header from "./shared/Header.jsx";

const Layout = () => {
  const alepha = useInject(Alepha);

  return (
    <>
      {alepha.isProduction() && <Analytics />}
      {alepha.isProduction() && <SpeedInsights />}
      <AlephaMantineProvider
        mantine={{
          theme: theme.mantine,
        }}
      >
        <Flex className={"root"}>
          <Header />
          <NestedView />
        </Flex>
      </AlephaMantineProvider>
    </>
  );
};

export default Layout;
