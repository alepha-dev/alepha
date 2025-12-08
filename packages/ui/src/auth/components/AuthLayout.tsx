import { NestedView } from "@alepha/react";
import { AlephaMantineProvider } from "@alepha/ui";
import { Flex } from "@mantine/core";

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
