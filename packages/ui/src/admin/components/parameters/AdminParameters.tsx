import { Flex, Text } from "@alepha/ui";
import { Loader, Stack } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import type {
  AdminConfigController,
  ConfigTreeNode,
  Parameter,
} from "alepha/api/parameters";
import { useClient } from "alepha/react";
import { useCallback, useEffect, useState } from "react";
import ParameterDetails from "./ParameterDetails.tsx";
import ParameterHistory from "./ParameterHistory.tsx";
import ParameterTree from "./ParameterTree.tsx";
import type { ConfigValue } from "./types.ts";

const AdminParameters = () => {
  const client = useClient<AdminConfigController>();

  // State
  const [treeData, setTreeData] = useState<ConfigTreeNode[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);
  const [configValue, setConfigValue] = useState<ConfigValue | null>(null);
  const [history, setHistory] = useState<Parameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load tree data
  const loadTree = useCallback(async () => {
    try {
      const tree = await client.getConfigTree({});
      setTreeData(tree as ConfigTreeNode[]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load config value and history when selection changes
  const loadConfigDetails = useCallback(async (name: string) => {
    setLoadingConfig(true);
    setLoadingHistory(true);

    try {
      const [current] = await Promise.all([
        client.getCurrent({ params: { name } }),
      ]);
      setConfigValue(current);
      setHistory([]);
    } finally {
      setLoadingConfig(false);
      setLoadingHistory(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Load details when selection changes
  useEffect(() => {
    if (selectedConfig) {
      loadConfigDetails(selectedConfig);
    } else {
      setConfigValue(null);
      setHistory([]);
    }
  }, [selectedConfig, loadConfigDetails]);

  // Handle rollback
  const handleRollback = async (version: number) => {
    if (!selectedConfig) return;

    await client.rollback({
      params: { name: selectedConfig },
      body: { targetVersion: version },
    });

    // Reload details
    await loadConfigDetails(selectedConfig);
  };

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  // Empty state when no configs exist
  if (treeData.length === 0) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Stack align="center" gap="xs">
          <IconSettings
            size={48}
            stroke={1.5}
            color="var(--mantine-color-dimmed)"
          />
          <Text c="dimmed">No Parameters Found</Text>
          <Text size="xs" c="dimmed" ta="center" maw={400}>
            Define parameters using the $config primitive to manage dynamic
            application settings. Parameters will appear here once created.
          </Text>
        </Stack>
      </Flex>
    );
  }

  return (
    <Flex flex={1} gap={"xs"} h="100%">
      <ParameterTree
        treeData={treeData}
        selectedConfig={selectedConfig}
        onSelect={setSelectedConfig}
        onRefresh={loadTree}
      />

      <ParameterDetails
        selectedConfig={selectedConfig}
        configValue={configValue}
        loading={loadingConfig}
      />

      <ParameterHistory
        selectedConfig={selectedConfig}
        history={history}
        loading={loadingHistory}
        onRollback={handleRollback}
      />
    </Flex>
  );
};

export default AdminParameters;
