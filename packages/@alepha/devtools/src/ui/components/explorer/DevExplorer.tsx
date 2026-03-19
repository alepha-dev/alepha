import { devMetadataSchema } from "@alepha/devtools";
import { Flex, ui } from "@alepha/ui";
import { ScrollArea, Text, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { t } from "alepha";
import { useInject } from "alepha/react";
import { useQueryParams } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExplorerTree, type TreeNode } from "./ExplorerTree.tsx";
import { DevPanelAction } from "./panels/DevPanelAction.tsx";
import { DevPanelCache } from "./panels/DevPanelCache.tsx";
import { DevPanelPage } from "./panels/DevPanelPage.tsx";
import { DevPanelQueue } from "./panels/DevPanelQueue.tsx";
import { DevPanelTopic } from "./panels/DevPanelTopic.tsx";

const querySchema = t.object({
  selected: t.optional(t.text()),
  open: t.optional(t.text()),
});

const buildTree = (metadata: any): TreeNode[] => {
  const nodes: TreeNode[] = [];

  // Actions grouped by group name, split on ":" for nested folders
  if (metadata.actions?.length > 0) {
    const actionsRoot: TreeNode = {
      id: "actions",
      label: "actions",
      type: "folder",
      children: [],
    };

    // Group actions by their group name
    const groups = new Map<string, any[]>();
    for (const action of metadata.actions) {
      const group = action.group || "default";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(action);
    }

    // Insert each group into the tree, splitting on ":"
    for (const [group, actions] of Array.from(groups.entries()).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const parts = group.split(":");
      let current = actionsRoot;

      for (let i = 0; i < parts.length; i++) {
        const folderId = `actions:${parts.slice(0, i + 1).join(":")}`;
        let child = current.children?.find((c) => c.id === folderId);
        if (!child) {
          child = {
            id: folderId,
            label: parts[i],
            type: "folder" as const,
            children: [],
          };
          current.children = current.children ?? [];
          current.children.push(child);
        }
        current = child;
      }

      // Add action leaves to the deepest folder
      const actionLeaves = actions
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
        .map((action: any) => ({
          id: `action:${action.method}:${action.fullPath}`,
          label: action.name,
          type: "action" as const,
          data: action,
        }));
      current.children = current.children ?? [];
      current.children.push(...actionLeaves);
    }

    nodes.push(actionsRoot);
  }

  // Pages (tree respecting parent/child)
  if (metadata.pages?.length > 0) {
    const pageNodeMap = new Map<string, TreeNode>();
    const rootPages: TreeNode[] = [];

    // Create all page nodes
    for (const page of metadata.pages) {
      pageNodeMap.set(page.name, {
        id: `page:${page.name}`,
        label: page.label || page.name,
        type: "page" as const,
        data: page,
        children: [],
      });
    }

    // Build parent/child relationships using both parentName and childrenNames
    const attached = new Set<string>();

    // 1) parent → child (from parentName on each page)
    for (const page of metadata.pages) {
      if (page.parentName && pageNodeMap.has(page.parentName)) {
        const parent = pageNodeMap.get(page.parentName)!;
        parent.children = parent.children ?? [];
        if (!attached.has(page.name)) {
          parent.children.push(pageNodeMap.get(page.name)!);
          attached.add(page.name);
        }
      }
    }

    // 2) parent → children (from childrenNames on each page)
    for (const page of metadata.pages) {
      if (page.childrenNames) {
        const parentNode = pageNodeMap.get(page.name)!;
        for (const childName of page.childrenNames) {
          if (pageNodeMap.has(childName) && !attached.has(childName)) {
            parentNode.children = parentNode.children ?? [];
            parentNode.children.push(pageNodeMap.get(childName)!);
            attached.add(childName);
          }
        }
      }
    }

    // Remaining pages without a parent go to root
    for (const page of metadata.pages) {
      if (!attached.has(page.name)) {
        rootPages.push(pageNodeMap.get(page.name)!);
      }
    }

    // Remove empty children arrays for leaf nodes
    const cleanChildren = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.children?.length === 0) {
          node.children = undefined;
        } else if (node.children) {
          cleanChildren(node.children);
        }
      }
    };
    cleanChildren(rootPages);

    nodes.push({
      id: "pages",
      label: "pages",
      type: "folder",
      children: rootPages,
    });
  }

  // Queues
  if (metadata.queues?.length > 0) {
    nodes.push({
      id: "queues",
      label: "queues",
      type: "folder",
      children: metadata.queues.map((q: any) => ({
        id: `queue:${q.name}`,
        label: q.name,
        type: "queue" as const,
        data: q,
      })),
    });
  }

  // Topics
  if (metadata.topics?.length > 0) {
    nodes.push({
      id: "topics",
      label: "topics",
      type: "folder",
      children: metadata.topics.map((topic: any) => ({
        id: `topic:${topic.name}`,
        label: topic.name,
        type: "topic" as const,
        data: topic,
      })),
    });
  }

  // Caches
  if (metadata.caches?.length > 0) {
    nodes.push({
      id: "caches",
      label: "caches",
      type: "folder",
      children: metadata.caches.map((cache: any) => ({
        id: `cache:${cache.name}`,
        label: cache.name,
        type: "cache" as const,
        data: cache,
      })),
    });
  }

  return nodes;
};

export const DevExplorer = () => {
  const http = useInject(HttpClient);
  const [metadata, setMetadata] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });
  const [openNodes, setOpenNodes] = useState<Set<string>>(
    new Set(params.open ? params.open.split(",") : ["routes", "actions"]),
  );

  useEffect(() => {
    http
      .fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => setMetadata(res.data))
      .catch(() => {});
  }, [http]);

  const tree = useMemo(() => (metadata ? buildTree(metadata) : []), [metadata]);

  const selectedId = params.selected ?? "";

  const selectedData = useMemo(() => {
    if (!selectedId || !metadata) return null;
    const [type, ...rest] = selectedId.split(":");
    const key = rest.join(":");
    switch (type) {
      case "action": {
        const sepIdx = key.indexOf(":");
        const method = sepIdx >= 0 ? key.slice(0, sepIdx) : "";
        const path = sepIdx >= 0 ? key.slice(sepIdx + 1) : key;
        return {
          type: "action",
          data: metadata.actions?.find(
            (a: any) => a.method === method && a.fullPath === path,
          ),
        };
      }
      case "page":
        return {
          type: "page",
          data: metadata.pages?.find((p: any) => p.name === key),
        };
      case "queue":
        return {
          type: "queue",
          data: metadata.queues?.find((q: any) => q.name === key),
        };
      case "topic":
        return {
          type: "topic",
          data: metadata.topics?.find((t: any) => t.name === key),
        };
      case "cache":
        return {
          type: "cache",
          data: metadata.caches?.find((c: any) => c.name === key),
        };
      default:
        return null;
    }
  }, [selectedId, metadata]);

  const handleSelect = useCallback(
    (id: string) => {
      setParams({ selected: id, open: Array.from(openNodes).join(",") });
    },
    [setParams, openNodes],
  );

  const handleToggle = useCallback(
    (id: string) => {
      setOpenNodes((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setParams({
          selected: params.selected,
          open: Array.from(next).join(","),
        });
        return next;
      });
    },
    [setParams, params.selected],
  );

  return (
    <Flex style={{ flex: 1, overflow: "hidden" }}>
      {/* Tree sidebar */}
      <Flex
        w={280}
        style={{
          borderRight: `1px solid ${ui.colors.border}`,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Flex p="xs">
          <TextInput
            placeholder="Search..."
            size="xs"
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </Flex>
        <ScrollArea style={{ flex: 1 }} px="xs" pb="xs">
          <ExplorerTree
            nodes={tree}
            selectedId={selectedId}
            openNodes={openNodes}
            search={search}
            onSelect={handleSelect}
            onToggle={handleToggle}
          />
        </ScrollArea>
      </Flex>

      {/* Detail panel */}
      <Flex style={{ flex: 1, overflow: "auto" }} p="lg">
        {!selectedData && (
          <Flex align="center" justify="center" h="100%">
            <Text c="dimmed" fz="sm">
              Select a resource from the tree
            </Text>
          </Flex>
        )}
        {selectedData?.type === "action" && selectedData.data && (
          <DevPanelAction action={selectedData.data} />
        )}
        {selectedData?.type === "page" && selectedData.data && (
          <DevPanelPage page={selectedData.data} />
        )}
        {selectedData?.type === "queue" && selectedData.data && (
          <DevPanelQueue queue={selectedData.data} />
        )}
        {selectedData?.type === "topic" && selectedData.data && (
          <DevPanelTopic topic={selectedData.data} />
        )}
        {selectedData?.type === "cache" && selectedData.data && (
          <DevPanelCache cache={selectedData.data} />
        )}
      </Flex>
    </Flex>
  );
};

export default DevExplorer;
