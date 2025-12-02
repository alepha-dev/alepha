import { NestedView } from "@alepha/react";
import { Flex } from "@mantine/core";

const AuthLayout = () => {
  return (
    <Flex flex={1} align={"center"} h={"100vh"} justify={"center"}>
      <NestedView />
    </Flex>
  );
};

export default AuthLayout;
