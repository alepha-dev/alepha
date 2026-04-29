import { AlephaMantineProvider } from "@alepha/mantine";
import { Flex } from "@mantine/core";
import { NestedView } from "alepha/react/router";

const AuthLayout = () => {
  return (
    <AlephaMantineProvider omnibar={false}>
      <Flex flex={1} align={"center"} h={"100vh"} justify={"center"}>
        <NestedView />
      </Flex>
    </AlephaMantineProvider>
  );
};

export default AuthLayout;
