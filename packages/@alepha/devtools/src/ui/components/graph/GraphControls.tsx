import { ActionButton, Flex, ui } from "@alepha/ui";
import {
  Badge,
  Checkbox,
  SegmentedControl,
  Select,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconBox,
  IconBoxMultiple,
  IconDownload,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
  IconSearch,
  IconTopologyRing,
} from "@tabler/icons-react";
import type { GraphFilters, LayoutType, ViewMode } from "./types.ts";

interface GraphControlsProps {
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  modules: string[];
  nodeCount: number;
  edgeCount: number;
  onExport: () => void;
}

export const GraphControls = ({
  filters,
  onFiltersChange,
  layout,
  onLayoutChange,
  modules,
  nodeCount,
  edgeCount,
  onExport,
}: GraphControlsProps) => {
  const isModuleView = filters.viewMode === "modules";

  return (
    <Flex gap="sm" wrap="wrap" align="center">
      <Flex>
        <SegmentedControl
          size="xs"
          value={filters.viewMode}
          onChange={(value) =>
            onFiltersChange({ ...filters, viewMode: value as ViewMode })
          }
          data={[
            {
              label: (
                <Tooltip label="Modules">
                  <IconBoxMultiple
                    size={ui.sizes.icon.sm}
                    style={{ marginTop: 2 }}
                  />
                </Tooltip>
              ),
              value: "modules",
            },
            {
              label: (
                <Tooltip label="Services">
                  <IconBox size={ui.sizes.icon.sm} style={{ marginTop: 2 }} />
                </Tooltip>
              ),
              value: "providers",
            },
          ]}
        />
      </Flex>

      <TextInput
        placeholder={isModuleView ? "Search modules..." : "Search services..."}
        leftSection={<IconSearch size={14} />}
        value={filters.search}
        onChange={(e) =>
          onFiltersChange({ ...filters, search: e.currentTarget.value })
        }
        size="xs"
        style={{ width: 200 }}
      />

      {!isModuleView && (
        <Select
          placeholder="Filter by module"
          value={filters.module}
          onChange={(value) =>
            onFiltersChange({ ...filters, module: value || "all" })
          }
          data={[
            { label: "All modules", value: "all" },
            ...modules.map((m) => ({ label: m, value: m })),
          ]}
          size="xs"
          style={{ width: 200 }}
          clearable
        />
      )}

      <Checkbox
        label="Hide framework"
        checked={filters.hideFramework}
        onChange={(e) =>
          onFiltersChange({
            ...filters,
            hideFramework: e.currentTarget.checked,
          })
        }
        size="xs"
      />

      <SegmentedControl
        size="xs"
        value={layout}
        onChange={(value) => onLayoutChange(value as LayoutType)}
        data={[
          {
            label: (
              <Tooltip label="Hierarchical">
                <IconLayoutDistributeVertical size={14} />
              </Tooltip>
            ),
            value: "dagre",
          },
          {
            label: (
              <Tooltip label="Circular">
                <IconTopologyRing size={14} />
              </Tooltip>
            ),
            value: "circular",
          },
          {
            label: (
              <Tooltip label="Force">
                <IconLayoutDistributeHorizontal size={14} />
              </Tooltip>
            ),
            value: "force",
          },
        ]}
      />

      <Flex gap={4}>
        <Badge size="xs" variant="light" color="gray">
          {nodeCount} {isModuleView ? "modules" : "services"}
        </Badge>
        <Badge size="xs" variant="light" color="gray">
          {edgeCount} edges
        </Badge>
      </Flex>

      <ActionButton
        size="sm"
        variant="subtle"
        tooltip="Export as PNG"
        onClick={onExport}
        icon={<IconDownload size={14} />}
      />
    </Flex>
  );
};
