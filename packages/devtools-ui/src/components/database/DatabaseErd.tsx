import { ui } from "@alepha/ui";
import { Flex } from "@mantine/core";
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
import { EntityNode } from "./EntityNode.tsx";

const nodeTypes = { entity: EntityNode };

const buildGraph = (entities: any[]): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = entities.map((entity, i) => {
    const cols = Math.ceil(Math.sqrt(entities.length));
    const row = Math.floor(i / cols);
    const col = i % cols;
    return {
      id: entity.name,
      type: "entity",
      position: { x: col * 320, y: row * 300 },
      data: entity,
    };
  });

  const edges: Edge[] = [];
  for (const entity of entities) {
    for (const column of entity.columns ?? []) {
      if (column.ref) {
        edges.push({
          id: `${entity.name}.${column.name}->${column.ref.entity}`,
          source: entity.name,
          target: column.ref.entity,
          label: `${column.name} → ${column.ref.column}`,
          style: { stroke: "var(--mantine-color-blue-6)", strokeWidth: 1.5 },
          labelStyle: { fontSize: 10, fill: "var(--mantine-color-dimmed)" },
          animated: true,
        });
      }
    }
  }

  return { nodes, edges };
};

const ErdFlow = ({ entities }: { entities: any[] }) => {
  const graph = useMemo(() => buildGraph(entities), [entities]);
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={{ background: ui.colors.background }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls />
      <MiniMap
        nodeColor="var(--mantine-color-dark-4)"
        maskColor="rgba(0,0,0,0.6)"
        style={{ backgroundColor: ui.colors.surface }}
      />
    </ReactFlow>
  );
};

export const DatabaseErd = ({ entities }: { entities: any[] }) => {
  return (
    <Flex
      flex={1}
      h="100%"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      <ReactFlowProvider>
        <ErdFlow entities={entities} />
      </ReactFlowProvider>
    </Flex>
  );
};
