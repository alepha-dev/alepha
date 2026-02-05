import { Text, useToast } from "@alepha/ui";
import { Card, Flex, Stack } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import type {
  AdminParameterController,
  Parameter,
  ParameterTreeNode,
} from "alepha/api/parameters";
import { useClient } from "alepha/react";
import { useCallback, useEffect, useState } from "react";
import ParameterDetails from "./ParameterDetails.tsx";
import ParameterEmptyState from "./ParameterEmptyState.tsx";
import ParameterHistory from "./ParameterHistory.tsx";
import ParameterTree from "./ParameterTree.tsx";
import type { ParameterValue } from "./types.ts";

export interface AdminParametersProps {
  treeData: ParameterTreeNode[];
}

const AdminParameters = ({
  treeData: initialTreeData,
}: AdminParametersProps) => {
  const client = useClient<AdminParameterController>();
  const toast = useToast();

  // State
  const [treeData, setTreeData] =
    useState<ParameterTreeNode[]>(initialTreeData);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);
  const [configValue, setConfigValue] = useState<ParameterValue | null>(null);
  const [history, setHistory] = useState<Parameter[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  // Refresh tree data
  const handleRefresh = useCallback(async () => {
    try {
      const tree = await client.getParameterTree({});
      setTreeData(tree as ParameterTreeNode[]);
    } catch (error) {
      toast.danger({
        title: "Failed to refresh parameters",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [client, toast]);

  // Load config value and history when selection changes
  const loadConfigDetails = useCallback(
    async (name: string) => {
      setLoadingConfig(true);
      setLoadingHistory(true);

      try {
        const [currentResponse, historyResponse] = await Promise.all([
          client.getCurrent({ params: { name } }),
          client.getHistory({ params: { name } }),
        ]);
        setConfigValue(currentResponse);
        setHistory(historyResponse.versions);
      } catch (error) {
        toast.danger({
          title: "Failed to load configuration",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        setConfigValue(null);
        setHistory([]);
      } finally {
        setLoadingConfig(false);
        setLoadingHistory(false);
      }
    },
    [client, toast],
  );

  // Handle save
  const handleSave = useCallback(
    async (values: Record<string, unknown>) => {
      if (!selectedConfig || !configValue) return;

      setSaving(true);
      try {
        await client.createVersion({
          params: { name: selectedConfig },
          body: {
            content: values,
            schemaHash: "", // Schema hash is computed server-side when empty
            changeDescription: "Updated via admin UI",
          },
        });

        toast.success({
          title: "Configuration saved",
          message: `${selectedConfig} has been updated`,
        });

        // Reload details
        await loadConfigDetails(selectedConfig);
      } catch (error) {
        toast.danger({
          title: "Failed to save configuration",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [client, selectedConfig, configValue, loadConfigDetails, toast],
  );

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
  const handleRollback = useCallback(
    async (version: number) => {
      if (!selectedConfig) return;

      try {
        await client.rollback({
          params: { name: selectedConfig },
          body: { targetVersion: version },
        });

        toast.success({
          title: "Rollback successful",
          message: `${selectedConfig} rolled back to version ${version}`,
        });

        // Reload details
        await loadConfigDetails(selectedConfig);
      } catch (error) {
        toast.danger({
          title: "Rollback failed",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
    [client, selectedConfig, loadConfigDetails, toast],
  );

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
            Define parameters using the $parameter primitive to manage dynamic
            application settings. Parameters will appear here once created.
          </Text>
        </Stack>
      </Flex>
    );
  }

  return (
    <Flex flex={1} p="md">
      <Card
        withBorder
        p={0}
        w={"100%"}
        style={{
          flexDirection: "row",
        }}
      >
        <ParameterTree
          treeData={treeData}
          selectedConfig={selectedConfig}
          onSelect={setSelectedConfig}
          onRefresh={handleRefresh}
        />

        {selectedConfig ? (
          <>
            <ParameterDetails
              selectedConfig={selectedConfig}
              configValue={configValue}
              loading={loadingConfig}
              saving={saving}
              onSave={handleSave}
            />

            <ParameterHistory
              selectedConfig={selectedConfig}
              history={history}
              loading={loadingHistory}
              onRollback={handleRollback}
            />
          </>
        ) : (
          <ParameterEmptyState />
        )}
      </Card>
    </Flex>
  );
};

export default AdminParameters;
