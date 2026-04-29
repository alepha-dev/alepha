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
          style: { stroke: "hsl(var(--primary))", strokeWidth: 1.5 },
          labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
          animated: true,
        });
      }
    }
  }

  return { nodes, edges };
};

interface ErdFlowProps {
  entities: any[];
}

const ErdFlow = (props: ErdFlowProps) => {
  const graph = useMemo(() => buildGraph(props.entities), [props.entities]);
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
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls />
      <MiniMap maskColor="rgba(0,0,0,0.6)" />
    </ReactFlow>
  );
};

interface DatabaseErdProps {
  entities: any[];
}

export const DatabaseErd = (props: DatabaseErdProps) => {
  return (
    <div className="absolute inset-0 flex h-full flex-1">
      <ReactFlowProvider>
        <ErdFlow entities={props.entities} />
      </ReactFlowProvider>
    </div>
  );
};
