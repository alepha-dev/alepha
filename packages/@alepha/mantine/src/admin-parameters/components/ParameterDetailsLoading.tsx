import { Flex } from "@alepha/mantine";
import { Loader } from "@mantine/core";

/**
 * Loading state for the parameter details panel.
 */
const ParameterDetailsLoading = () => (
  <Flex
    flex={1}
    h="100%"
    p="md"
    style={{
      overflow: "hidden",
      minWidth: 0,
      display: "flex",
    }}
  >
    <Flex flex={1} justify="center" align="center" h="100%">
      <Loader size="sm" />
    </Flex>
  </Flex>
);

export default ParameterDetailsLoading;
