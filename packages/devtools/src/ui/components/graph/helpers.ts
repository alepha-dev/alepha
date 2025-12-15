import type { DevProviderMetadata } from "../../../api/schemas/DevProviderMetadata.ts";
import type {
  GraphFilters,
  LayoutType,
  ProviderEdge,
  ProviderNode,
} from "./types.ts";

export const buildProviderGraph = (
  providers: DevProviderMetadata[],
  filters: GraphFilters,
): { nodes: ProviderNode[]; edges: ProviderEdge[] } => {
  // Build dependents map (reverse of dependencies)
  const dependentsMap = new Map<string, string[]>();
  for (const provider of providers) {
    for (const dep of provider.dependencies) {
      const dependents = dependentsMap.get(dep) || [];
      dependents.push(provider.name);
      dependentsMap.set(dep, dependents);
    }
  }

  // Filter providers
  const filtered = providers.filter((p) => {
    if (filters.hideFramework && p.module?.startsWith("alepha.")) {
      return false;
    }
    if (
      filters.module &&
      filters.module !== "all" &&
      p.module !== filters.module
    ) {
      return false;
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      return (
        p.name.toLowerCase().includes(searchLower) ||
        p.module?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const filteredNames = new Set(filtered.map((p) => p.name));

  // Create nodes
  const nodes: ProviderNode[] = filtered.map((provider) => ({
    id: provider.name,
    type: "provider",
    position: { x: 0, y: 0 },
    data: {
      label: provider.name,
      module: provider.module,
      dependencies: provider.dependencies,
      dependents: dependentsMap.get(provider.name) || [],
      aliases: provider.aliases,
      isModule: false,
    },
  }));

  // Create edges (only between visible nodes)
  const edges: ProviderEdge[] = [];
  for (const provider of filtered) {
    for (const dep of provider.dependencies) {
      if (filteredNames.has(dep)) {
        edges.push({
          id: `${provider.name}->${dep}`,
          source: provider.name,
          target: dep,
          animated: false,
          style: { stroke: "#495057", strokeWidth: 1.5 },
        });
      }
    }
  }

  return { nodes, edges };
};

export const buildModuleGraph = (
  providers: DevProviderMetadata[],
  filters: GraphFilters,
): { nodes: ProviderNode[]; edges: ProviderEdge[] } => {
  // Group providers by module
  const moduleMap = new Map<string, DevProviderMetadata[]>();
  for (const provider of providers) {
    const module = provider.module || "Other";
    if (filters.hideFramework && module.startsWith("alepha.")) {
      continue;
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      if (!module.toLowerCase().includes(searchLower)) {
        continue;
      }
    }
    const list = moduleMap.get(module) || [];
    list.push(provider);
    moduleMap.set(module, list);
  }

  // Build module dependencies and dependents
  const moduleDeps = new Map<string, Set<string>>();
  const moduleDependents = new Map<string, Set<string>>();

  for (const [module, moduleProviders] of moduleMap) {
    moduleDeps.set(module, new Set());
    moduleDependents.set(module, new Set());
  }

  for (const [module, moduleProviders] of moduleMap) {
    for (const provider of moduleProviders) {
      for (const dep of provider.dependencies) {
        // Find which module this dependency belongs to
        const depProvider = providers.find((p) => p.name === dep);
        if (depProvider) {
          const depModule = depProvider.module || "Other";
          if (depModule !== module && moduleMap.has(depModule)) {
            moduleDeps.get(module)?.add(depModule);
            moduleDependents.get(depModule)?.add(module);
          }
        }
      }
    }
  }

  // Filter by selected module
  let filteredModules = Array.from(moduleMap.keys());
  if (filters.module && filters.module !== "all") {
    filteredModules = filteredModules.filter((m) => m === filters.module);
  }
  const filteredModuleSet = new Set(filteredModules);

  // Create module nodes
  const nodes: ProviderNode[] = filteredModules.map((module) => {
    const moduleProviders = moduleMap.get(module) || [];
    return {
      id: module,
      type: "provider",
      position: { x: 0, y: 0 },
      data: {
        label: module,
        module: module,
        dependencies: Array.from(moduleDeps.get(module) || []),
        dependents: Array.from(moduleDependents.get(module) || []),
        providers: moduleProviders.map((p) => p.name),
        providerCount: moduleProviders.length,
        isModule: true,
      },
    };
  });

  // Create edges between modules
  const edges: ProviderEdge[] = [];
  const edgeSet = new Set<string>();

  for (const module of filteredModules) {
    for (const dep of moduleDeps.get(module) || []) {
      if (filteredModuleSet.has(dep)) {
        const edgeId = `${module}->${dep}`;
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);
          edges.push({
            id: edgeId,
            source: module,
            target: dep,
            animated: false,
            style: { stroke: "#495057", strokeWidth: 1.5 },
          });
        }
      }
    }
  }

  return { nodes, edges };
};

export const buildGraph = (
  providers: DevProviderMetadata[],
  filters: GraphFilters,
): { nodes: ProviderNode[]; edges: ProviderEdge[] } => {
  if (filters.viewMode === "modules") {
    return buildModuleGraph(providers, filters);
  }
  return buildProviderGraph(providers, filters);
};

export const applyDagreLayout = (
  nodes: ProviderNode[],
  edges: ProviderEdge[],
  direction: "TB" | "LR" = "TB",
): ProviderNode[] => {
  // Simple grid layout as fallback (dagre would need additional library)
  const nodeWidth = 180;
  const nodeHeight = 60;
  const horizontalSpacing = 50;
  const verticalSpacing = 80;

  // Build adjacency list and calculate levels
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adj.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // Topological sort to get levels
  const levels = new Map<string, number>();
  const queue: string[] = [];

  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
      levels.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) || 0;

    for (const neighbor of adj.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        queue.push(neighbor);
        levels.set(neighbor, currentLevel + 1);
      }
    }
  }

  // Handle cycles - assign remaining nodes to max level + 1
  const maxLevel = Math.max(...Array.from(levels.values()), 0);
  for (const node of nodes) {
    if (!levels.has(node.id)) {
      levels.set(node.id, maxLevel + 1);
    }
  }

  // Group nodes by level
  const levelGroups = new Map<number, string[]>();
  for (const [id, level] of levels) {
    const group = levelGroups.get(level) || [];
    group.push(id);
    levelGroups.set(level, group);
  }

  // Position nodes
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const positioned: ProviderNode[] = [];

  for (const [level, ids] of levelGroups) {
    const levelWidth = ids.length * (nodeWidth + horizontalSpacing);
    const startX = -levelWidth / 2;

    ids.forEach((id, index) => {
      const node = nodeMap.get(id);
      if (node) {
        positioned.push({
          ...node,
          position: {
            x:
              direction === "TB"
                ? startX + index * (nodeWidth + horizontalSpacing)
                : level * (nodeWidth + horizontalSpacing),
            y:
              direction === "TB"
                ? level * (nodeHeight + verticalSpacing)
                : startX + index * (nodeHeight + verticalSpacing),
          },
        });
      }
    });
  }

  return positioned;
};

export const applyForceLayout = (nodes: ProviderNode[]): ProviderNode[] => {
  // Simple circular layout for force simulation
  const radius = Math.max(200, nodes.length * 30);
  const angleStep = (2 * Math.PI) / nodes.length;

  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: Math.cos(index * angleStep) * radius,
      y: Math.sin(index * angleStep) * radius,
    },
  }));
};

export const applyCircularLayout = (
  nodes: ProviderNode[],
  groupByModule: boolean = true,
): ProviderNode[] => {
  if (!groupByModule) {
    return applyForceLayout(nodes);
  }

  // Group by module
  const moduleGroups = new Map<string, ProviderNode[]>();
  for (const node of nodes) {
    const module = node.data.module || "Other";
    const group = moduleGroups.get(module) || [];
    group.push(node);
    moduleGroups.set(module, group);
  }

  const modules = Array.from(moduleGroups.keys()).sort();
  const moduleAngleStep = (2 * Math.PI) / modules.length;
  const moduleRadius = Math.max(300, modules.length * 80);

  const positioned: ProviderNode[] = [];

  modules.forEach((module, moduleIndex) => {
    const moduleNodes = moduleGroups.get(module) || [];
    const moduleAngle = moduleIndex * moduleAngleStep;
    const moduleCenterX = Math.cos(moduleAngle) * moduleRadius;
    const moduleCenterY = Math.sin(moduleAngle) * moduleRadius;

    const innerRadius = Math.max(100, moduleNodes.length * 25);
    const nodeAngleStep = (2 * Math.PI) / moduleNodes.length;

    moduleNodes.forEach((node, nodeIndex) => {
      const nodeAngle = nodeIndex * nodeAngleStep;
      positioned.push({
        ...node,
        position: {
          x: moduleCenterX + Math.cos(nodeAngle) * innerRadius,
          y: moduleCenterY + Math.sin(nodeAngle) * innerRadius,
        },
      });
    });
  });

  return positioned;
};

export const applyLayout = (
  nodes: ProviderNode[],
  edges: ProviderEdge[],
  layout: LayoutType,
): ProviderNode[] => {
  switch (layout) {
    case "dagre":
      return applyDagreLayout(nodes, edges);
    case "force":
      return applyForceLayout(nodes);
    case "circular":
      return applyCircularLayout(nodes);
    default:
      return applyDagreLayout(nodes, edges);
  }
};

export const findDependencyChain = (
  nodeId: string,
  nodes: ProviderNode[],
  edges: ProviderEdge[],
): Set<string> => {
  const chain = new Set<string>([nodeId]);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Find all dependencies (downstream)
  const findDeps = (id: string) => {
    const node = nodeMap.get(id);
    if (!node) return;
    for (const dep of node.data.dependencies) {
      if (!chain.has(dep)) {
        chain.add(dep);
        findDeps(dep);
      }
    }
  };

  // Find all dependents (upstream)
  const findDependents = (id: string) => {
    const node = nodeMap.get(id);
    if (!node) return;
    for (const dep of node.data.dependents) {
      if (!chain.has(dep)) {
        chain.add(dep);
        findDependents(dep);
      }
    }
  };

  findDeps(nodeId);
  findDependents(nodeId);

  return chain;
};

export const detectCircularDependencies = (
  nodes: ProviderNode[],
  edges: ProviderEdge[],
): string[][] => {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const adj = new Map<string, string[]>();

  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
  }

  const dfs = (node: string, path: string[]): void => {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of adj.get(node) || []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push([...path.slice(cycleStart), neighbor]);
      }
    }

    recStack.delete(node);
  };

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  return cycles;
};
