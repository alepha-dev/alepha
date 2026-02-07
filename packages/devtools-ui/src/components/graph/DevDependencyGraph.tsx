import { ui, useDialog } from "@alepha/ui";
import {
  ActionIcon,
  Alert,
  Badge,
  Flex,
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconFocusCentered,
  IconLock,
  IconLockOpen,
  IconMinus,
  IconPlus,
  IconTopologyRing,
} from "@tabler/icons-react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { useAction, useInject } from "alepha/react";
import "@xyflow/react/dist/style.css";
import { devMetadataSchema } from "alepha/devtools";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getModuleColor } from "./constants.ts";
import { GraphControls } from "./GraphControls.tsx";
import {
  applyLayout,
  buildGraph,
  detectCircularDependencies,
  findDependencyChain,
} from "./helpers.ts";
import { NodeDetails } from "./NodeDetails.tsx";
import { ProviderNode } from "./ProviderNode.tsx";
import type {
  GraphFilters,
  LayoutType,
  ProviderEdge,
  ProviderNodeData,
  ProviderNode as ProviderNodeType,
} from "./types.ts";

const nodeTypes = {
  provider: ProviderNode,
};

export const DevDependencyGraph = () => {
  const http = useInject(HttpClient);
  const [nodes, setNodes, onNodesChange] = useNodesState<ProviderNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ProviderEdge>([]);
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    data: ProviderNodeData;
  } | null>(null);
  const [layout, setLayout] = useState<LayoutType>("dagre");
  const [filters, setFilters] = useState<GraphFilters>({
    search: "",
    module: "all",
    hideFramework: false,
    viewMode: "modules",
  });

  const { loading, result } = useAction(
    {
      runOnInit: true,
      handler: () =>
        http.fetch("/__devtools/api/metadata", {
          schema: { response: devMetadataSchema },
        }),
    },
    [],
  );

  const providers = result?.data.providers || [];

  // Get unique modules
  const modules = useMemo(() => {
    const moduleSet = new Set<string>();
    for (const p of providers) {
      if (p.module) moduleSet.add(p.module);
    }
    return Array.from(moduleSet).sort();
  }, [providers]);

  // Build and layout graph
  useEffect(() => {
    if (providers.length === 0) return;

    const { nodes: rawNodes, edges: rawEdges } = buildGraph(providers, filters);
    const layoutedNodes = applyLayout(rawNodes, rawEdges, layout);

    setNodes(layoutedNodes);
    setEdges(rawEdges);
  }, [providers, filters, layout, setNodes, setEdges]);

  // Detect circular dependencies
  const circularDeps = useMemo(() => {
    return detectCircularDependencies(nodes as ProviderNodeType[], edges);
  }, [nodes, edges]);

  // Handle node click - highlight dependency chain
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: ProviderNodeType) => {
      setSelectedNode({ id: node.id, data: node.data });

      const chain = findDependencyChain(
        node.id,
        nodes as ProviderNodeType[],
        edges,
      );

      // Update nodes with highlight state
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            isHighlighted: chain.has(n.id),
            isSelected: n.id === node.id,
            isFaded: !chain.has(n.id),
          },
        })),
      );

      // Update edges with highlight state
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          animated: chain.has(e.source) && chain.has(e.target),
          style: {
            ...e.style,
            stroke:
              chain.has(e.source) && chain.has(e.target)
                ? getModuleColor(
                    (nodes as ProviderNodeType[]).find((n) => n.id === e.source)
                      ?.data.module,
                  )
                : "#495057",
            strokeWidth: chain.has(e.source) && chain.has(e.target) ? 2 : 1,
            opacity: chain.has(e.source) && chain.has(e.target) ? 1 : 0.3,
          },
        })),
      );
    },
    [nodes, edges, setNodes, setEdges],
  );

  // Handle pane click - clear selection
  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isHighlighted: false,
          isSelected: false,
          isFaded: false,
        },
      })),
    );
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        animated: false,
        style: { ...e.style, stroke: "#495057", strokeWidth: 1.5, opacity: 1 },
      })),
    );
  }, [setNodes, setEdges]);

  // Handle node click from details panel
  const handleDetailsNodeClick = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId) as
        | ProviderNodeType
        | undefined;
      if (node) {
        handleNodeClick({} as React.MouseEvent, node);
      }
    },
    [nodes, handleNodeClick],
  );

  const dialog = useDialog();

  // Export as PNG
  const handleExport = useCallback(() => {
    // Get the react-flow viewport element
    const viewport = document.querySelector(".react-flow__viewport");
    if (!viewport) return;

    // Use html2canvas or similar - for now just alert
    return dialog.alert({
      title: "Export",
      message: "Export feature requires html2canvas library. Coming soon!",
    });
  }, []);

  if (loading) {
    return (
      <Flex align="center" justify="center" h="100%">
        <Loader size="sm" />
      </Flex>
    );
  }

  return (
    <Flex p="xl" direction="column" gap="md" w="100%" h="100%" flex={1} mih={0}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm">
          <Flex
            bdrs={"sm"}
            h={"20px"}
            w={"4px"}
            bg={"var(--mantine-primary-color-filled)"}
          />
          <IconTopologyRing size={24} opacity={0.7} />
          <Text size="lg" fw={500}>
            Dependency Graph
          </Text>
        </Group>
      </Group>

      <GraphControls
        filters={filters}
        onFiltersChange={setFilters}
        layout={layout}
        onLayoutChange={setLayout}
        modules={modules}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        onExport={handleExport}
      />

      {circularDeps.length > 0 && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="orange"
          variant="light"
          p="xs"
        >
          <Flex align="center" gap="xs">
            <Text size="xs">Circular dependencies detected:</Text>
            {circularDeps.slice(0, 3).map((cycle, i) => (
              <Badge key={i} size="xs" color="orange" variant="light">
                {cycle.length} nodes
              </Badge>
            ))}
            {circularDeps.length > 3 && (
              <Text size="xs" c="dimmed">
                +{circularDeps.length - 3} more
              </Text>
            )}
          </Flex>
        </Alert>
      )}

      <Flex
        flex={1}
        h={"100%"}
        style={{
          borderRadius: 8,
          border: `1px solid ${ui.colors.border}`,
          position: "relative",
        }}
      >
        <Flex
          h={"100%"}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick as any}
              onPaneClick={handlePaneClick}
              nodeTypes={nodeTypes as any}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
              <MiniMap
                nodeColor={(node) =>
                  getModuleColor((node.data as ProviderNodeData)?.module)
                }
                maskColor="rgba(0, 0, 0, 0.5)"
                style={{ backgroundColor: ui.colors.surface }}
              />
              <FlowControls />
            </ReactFlow>
          </ReactFlowProvider>

          <NodeDetails
            node={selectedNode}
            onClose={() => handlePaneClick()}
            onNodeClick={handleDetailsNodeClick}
          />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default DevDependencyGraph;

const FlowControls = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const [isLocked, setIsLocked] = useState(false);

  return (
    <Stack
      gap={4}
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        zIndex: 10,
        backgroundColor: ui.colors.elevated,
        border: `1px solid ${ui.colors.border}`,
        borderRadius: 8,
        padding: 4,
      }}
    >
      <Tooltip label="Zoom in" position="right">
        <ActionIcon size="sm" variant="subtle" onClick={() => zoomIn()}>
          <IconPlus size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Zoom out" position="right">
        <ActionIcon size="sm" variant="subtle" onClick={() => zoomOut()}>
          <IconMinus size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Fit view" position="right">
        <ActionIcon
          size="sm"
          variant="subtle"
          onClick={() => fitView({ padding: 0.2 })}
        >
          <IconFocusCentered size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={isLocked ? "Unlock" : "Lock"} position="right">
        <ActionIcon
          size="sm"
          variant="subtle"
          onClick={() => setIsLocked(!isLocked)}
        >
          {isLocked ? <IconLock size={14} /> : <IconLockOpen size={14} />}
        </ActionIcon>
      </Tooltip>
    </Stack>
  );
};
