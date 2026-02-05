import { AlephaMantineProvider } from "@alepha/ui";
import { Flex } from "@mantine/core";
import { NestedView } from "alepha/react/router";
import { theme } from "../constants/theme.ts";
import Header from "./shared/Header.tsx";

const Layout = () => {
  return (
    <AlephaMantineProvider
      mantine={{
        theme: theme.mantine,
      }}
    >
      <Flex h={"100vh"} direction={"column"}>
        <Header />
        <NestedView />
      </Flex>
    </AlephaMantineProvider>
  );
};

export default Layout;
