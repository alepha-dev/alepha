import type { Edge, Node } from "@xyflow/react";

export interface ProviderNodeData extends Record<string, unknown> {
  label: string;
  module?: string;
  dependencies: string[];
  dependents: string[];
  aliases?: string[];
  providers?: string[]; // For module nodes, list of providers in this module
  providerCount?: number; // For module nodes
  isHighlighted?: boolean;
  isSelected?: boolean;
  isFaded?: boolean;
  isModule?: boolean; // True if this node represents a module
}

export type ProviderNode = Node<ProviderNodeData, "provider">;
export type ProviderEdge = Edge;

export type LayoutType = "dagre" | "force" | "circular";
export type ViewMode = "modules" | "providers";

export interface GraphFilters {
  search: string;
  module: string;
  hideFramework: boolean;
  viewMode: ViewMode;
}
