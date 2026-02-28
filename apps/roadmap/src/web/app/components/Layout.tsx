import { AlephaMantineProvider, Flex } from "@alepha/ui";
import { NestedView } from "alepha/react/router";
import { theme } from "../constants/theme.ts";
import Header from "./shared/header/Header.tsx";

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
