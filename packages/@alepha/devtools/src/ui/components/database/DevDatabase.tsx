import { Flex, ui } from "@alepha/mantine";
import { SegmentedControl } from "@mantine/core";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

export const DevDatabase = () => {
  const router = useRouter();
  const state = useRouterState();
  const tab = state.url.pathname.startsWith("/db/editor") ? "editor" : "erd";

  const handleTabChange = (value: string) => {
    router.push(value === "editor" ? "/db/editor" : "/db/erd");
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
            { label: "ERD", value: "erd" },
            { label: "Editor", value: "editor" },
          ]}
        />
      </Flex>
      <NestedView />
    </Flex>
  );
};

export default DevDatabase;
