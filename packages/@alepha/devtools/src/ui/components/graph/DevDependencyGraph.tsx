import { devMetadataSchema } from "@alepha/devtools";
import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
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
import { HttpClient } from "alepha/server";
import {
  AlertTriangle,
  Crosshair,
  Lock,
  LockOpen,
  Minus,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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

  const modules = useMemo(() => {
    const moduleSet = new Set<string>();
    for (const p of providers) {
      if (p.module) moduleSet.add(p.module);
    }
    return Array.from(moduleSet).sort();
  }, [providers]);

  useEffect(() => {
    if (providers.length === 0) return;

    const { nodes: rawNodes, edges: rawEdges } = buildGraph(providers, filters);
    const layoutedNodes = applyLayout(rawNodes, rawEdges, layout);

    setNodes(layoutedNodes);
    setEdges(rawEdges);
  }, [providers, filters, layout, setNodes, setEdges]);

  const circularDeps = useMemo(() => {
    return detectCircularDependencies(nodes as ProviderNodeType[], edges);
  }, [nodes, edges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: ProviderNodeType) => {
      setSelectedNode({ id: node.id, data: node.data });

      const chain = findDependencyChain(
        node.id,
        nodes as ProviderNodeType[],
        edges,
      );

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

  const handleExport = useCallback(() => {
    toast.info("Export feature requires html2canvas library. Coming soon!");
  }, []);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col gap-3 p-6">
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
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            <div className="flex items-center gap-2">
              <span className="text-xs">Circular dependencies detected:</span>
              {circularDeps.slice(0, 3).map((cycle, i) => (
                <Badge key={i} variant="destructive">
                  {cycle.length} nodes
                </Badge>
              ))}
              {circularDeps.length > 3 && (
                <span className="text-muted-foreground text-xs">
                  +{circularDeps.length - 3} more
                </span>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="border-border relative h-full flex-1 rounded-lg border">
        <div className="absolute inset-0 flex h-full">
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
              />
              <FlowControls />
            </ReactFlow>
          </ReactFlowProvider>

          <NodeDetails
            node={selectedNode}
            onClose={() => handlePaneClick()}
            onNodeClick={handleDetailsNodeClick}
          />
        </div>
      </div>
    </div>
  );
};

export default DevDependencyGraph;

const FlowControls = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const [isLocked, setIsLocked] = useState(false);

  return (
    <div className="bg-card border-border absolute bottom-4 left-4 z-10 flex flex-col gap-1 rounded-lg border p-1">
      <Button size="sm" variant="ghost" onClick={() => zoomIn()}>
        <Plus className="size-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => zoomOut()}>
        <Minus className="size-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => fitView({ padding: 0.2 })}
      >
        <Crosshair className="size-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setIsLocked(!isLocked)}>
        {isLocked ? (
          <Lock className="size-3.5" />
        ) : (
          <LockOpen className="size-3.5" />
        )}
      </Button>
    </div>
  );
};
