import { AlephaMantineProvider, Flex } from "@alepha/mantine";
import { Input } from "@mantine/core";
import { NestedView } from "alepha/react/router";
import { theme } from "../constants/theme.ts";
import Header from "./shared/header/Header.tsx";

const Layout = () => {
  return (
    <AlephaMantineProvider
      mantine={{
        theme: {
          ...theme.mantine,
          components: {
            InputWrapper: Input.Wrapper.extend({
              defaultProps: {
                inputWrapperOrder: ["label", "input", "description", "error"],
              },
            }),
          },
        },
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
