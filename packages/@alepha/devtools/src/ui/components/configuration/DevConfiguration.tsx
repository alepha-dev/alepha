import { Flex, ui } from "@alepha/ui";
import { SegmentedControl } from "@mantine/core";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

export const DevConfiguration = () => {
  const router = useRouter();
  const state = useRouterState();
  const tab = state.url.pathname.endsWith("/atoms") ? "atoms" : "env";

  const handleTabChange = (value: string) => {
    router.push(value === "atoms" ? "/conf/atoms" : "/conf/env");
  };

  return (
    <Flex direction="column" style={{ flex: 1 }}>
      <Flex
        px="md"
        py="xs"
        style={{ borderBottom: `1px solid ${ui.colors.border}` }}
      >
        <SegmentedControl
          size="xs"
          value={tab}
          onChange={handleTabChange}
          data={[
            { label: "Environment", value: "env" },
            { label: "Atoms", value: "atoms" },
          ]}
        />
      </Flex>
      <NestedView />
    </Flex>
  );
};

export default DevConfiguration;
