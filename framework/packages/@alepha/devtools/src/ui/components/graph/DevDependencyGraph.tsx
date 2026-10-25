import {
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useMetadata } from "../../hooks/useMetadata.ts";
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

  const { loading, data } = useMetadata();

  const providers = data?.providers || [];

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

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <GraphControls
        filters={filters}
        onFiltersChange={setFilters}
        layout={layout}
        onLayoutChange={setLayout}
        modules={modules}
        nodeCount={nodes.length}
        edgeCount={edges.length}
      />

      {/*
       * The cycle itself, not a count. "3 nodes" tells you a cycle exists;
       * `app.api → app.web → app.api` tells you which import to delete, which
       * is the only reason anyone reads this banner.
       */}
      {circularDeps.length > 0 && (
        <div className="dt-banner" data-tone="danger">
          <AlertTriangle size={12} />
          <span>
            {circularDeps.length === 1
              ? "1 circular dependency:"
              : `${circularDeps.length} circular dependencies:`}
          </span>
          {circularDeps.slice(0, 2).map((cycle, i) => (
            <span key={i} className="dt-mono" style={{ fontSize: 10 }}>
              {/*
               * Close the loop, unless the detector already returned it
               * closed — repeating the entry node twice reads as a longer
               * cycle than the one that exists.
               */}
              {(cycle[cycle.length - 1] === cycle[0]
                ? cycle
                : [...cycle, cycle[0]]
              ).join(" → ")}
            </span>
          ))}
          {circularDeps.length > 2 && (
            <span style={{ color: "var(--dt-fg-faint)" }}>
              +{circularDeps.length - 2} more
            </span>
          )}
        </div>
      )}

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
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
              {/*
               * No dot grid, no minimap, no zoom rail. The graph is small
               * enough to read at fit-view, and the minimap in particular
               * rendered as a bright white rectangle in a dark UI — a
               * navigation aid for a canvas that does not need navigating.
               */}
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
