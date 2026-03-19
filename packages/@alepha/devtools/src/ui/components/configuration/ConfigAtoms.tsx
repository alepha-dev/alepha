import type { DevAtomMetadata } from "@alepha/devtools";
import { devMetadataSchema } from "@alepha/devtools";
import { ActionButton, Flex, JsonViewer, ui } from "@alepha/ui";
import {
  Badge,
  NumberInput,
  ScrollArea,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  IconAtom,
  IconDeviceFloppy,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TreeView, type TreeViewNode } from "../shared/TreeView.tsx";

interface AtomTreeNode {
  key: string;
  label: string;
  atom?: DevAtomMetadata;
  children: AtomTreeNode[];
}

const buildAtomTree = (atoms: DevAtomMetadata[]): AtomTreeNode[] => {
  const root: AtomTreeNode = { key: "", label: "", children: [] };

  for (const atom of atoms) {
    const parts = atom.name.split(".");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i + 1).join(".");
      let child = current.children.find((c) => c.key === key);
      if (!child) {
        child = { key, label: parts[i], children: [] };
        current.children.push(child);
      }
      if (i === parts.length - 1) {
        child.atom = atom;
      }
      current = child;
    }
  }

  return root.children.map(collapseChain);
};

const collapseChain = (node: AtomTreeNode): AtomTreeNode => {
  while (!node.atom && node.children.length === 1) {
    const child = node.children[0];
    node = { ...child, label: `${node.label}.${child.label}` };
  }
  return { ...node, children: node.children.map(collapseChain) };
};

const toTreeViewNode = (node: AtomTreeNode): TreeViewNode => {
  const isLeaf = !!node.atom && node.children.length === 0;

  return {
    id: node.atom ? `atom:${node.atom.name}` : `folder:${node.key}`,
    label: node.label,
    icon: isLeaf ? (
      <IconAtom
        size={13}
        color="var(--mantine-color-violet-text)"
        style={{ flexShrink: 0 }}
      />
    ) : undefined,
    badge:
      isLeaf && node.atom?.currentValue !== undefined ? (
        <Badge size="xs" variant="light" color="green">
          set
        </Badge>
      ) : undefined,
    children:
      node.children.length > 0 ? node.children.map(toTreeViewNode) : undefined,
  };
};

const SchemaEditor = ({
  schema,
  value,
  onChange,
}: {
  schema: any;
  value: any;
  onChange: (value: any) => void;
}) => {
  if (!schema) return null;

  let actualSchema = schema;
  if (schema.anyOf) {
    const nonNull = schema.anyOf.find((t: any) => t.type !== "null");
    if (nonNull) actualSchema = nonNull;
  }

  const type = actualSchema.type;

  if (type === "object" && actualSchema.properties) {
    return (
      <Flex direction="column" gap="sm">
        {Object.entries(actualSchema.properties).map(
          ([key, propSchema]: [string, any]) => (
            <Flex key={key}>
              <Text fz="xs" fw={500} mb={4}>
                {propSchema.title || key}
                {propSchema.description && (
                  <Text span fz={10} c="dimmed" ml="xs">
                    {propSchema.description}
                  </Text>
                )}
              </Text>
              <SchemaEditor
                schema={propSchema}
                value={value?.[key]}
                onChange={(v) => onChange({ ...value, [key]: v })}
              />
            </Flex>
          ),
        )}
      </Flex>
    );
  }

  if (type === "boolean") {
    return (
      <Switch
        checked={value ?? false}
        onChange={(e) => onChange(e.currentTarget.checked)}
        size="sm"
      />
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <NumberInput
        size="xs"
        value={value ?? ""}
        onChange={(v) => onChange(v === "" ? undefined : v)}
        allowDecimal={type === "number"}
      />
    );
  }

  if (actualSchema.enum) {
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        style={{
          padding: "4px 8px",
          borderRadius: 4,
          border: `1px solid ${ui.colors.border}`,
          backgroundColor: ui.colors.surface,
          color: "inherit",
          fontSize: 12,
          width: "100%",
        }}
      >
        <option value="">Select...</option>
        {actualSchema.enum.map((opt: string) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  return (
    <TextInput
      size="xs"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  );
};

const AtomDetailPanel = ({
  atom,
  onSave,
}: {
  atom: DevAtomMetadata;
  onSave: (value: any) => void;
}) => {
  const [editValue, setEditValue] = useState<any>(
    atom.currentValue ?? atom.defaultValue,
  );
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    const val = atom.currentValue ?? atom.defaultValue;
    setEditValue(val);
    setJsonText(JSON.stringify(val, null, 2));
    setJsonError(null);
  }, [atom]);

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setEditValue(parsed);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON");
    }
  };

  const hasValue = atom.currentValue !== undefined;
  const schemaType = atom.schema?.type;
  const useJsonByDefault = !schemaType || schemaType === "array";

  return (
    <Flex direction="column" h="100%">
      {/* Header */}
      <Flex
        px="md"
        py="sm"
        style={{
          borderBottom: `1px solid ${ui.colors.border}`,
          flexShrink: 0,
        }}
      >
        <Flex align="center" gap="sm">
          <IconAtom size={16} opacity={0.5} />
          <Text fz="sm" fw={600} ff="monospace">
            {atom.name}
          </Text>
          <Badge size="xs" variant="light" color={hasValue ? "green" : "gray"}>
            {hasValue ? "has value" : "default"}
          </Badge>
        </Flex>
        {atom.description && (
          <Text fz="xs" c="dimmed" mt={4}>
            {atom.description}
          </Text>
        )}
      </Flex>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Flex direction="column" gap="lg">
          {/* Current / Default values */}
          <Flex gap="lg" wrap="wrap">
            <Flex style={{ flex: 1, minWidth: 200 }}>
              <Text
                fz={10}
                c="dimmed"
                tt="uppercase"
                fw={600}
                lts={0.5}
                mb="xs"
              >
                Current Value
              </Text>
              {atom.currentValue !== undefined ? (
                <JsonViewer data={atom.currentValue} maxDepth={3} />
              ) : (
                <Text fz="xs" c="dimmed" fs="italic">
                  (using default)
                </Text>
              )}
            </Flex>
            <Flex style={{ flex: 1, minWidth: 200 }}>
              <Text
                fz={10}
                c="dimmed"
                tt="uppercase"
                fw={600}
                lts={0.5}
                mb="xs"
              >
                Default Value
              </Text>
              {atom.defaultValue !== undefined ? (
                <JsonViewer data={atom.defaultValue} maxDepth={3} />
              ) : (
                <Text fz="xs" c="dimmed" fs="italic">
                  (no default)
                </Text>
              )}
            </Flex>
          </Flex>

          {/* Editor */}
          <Flex>
            <Flex align="center" justify="space-between" mb="sm">
              <Text fz={10} c="dimmed" tt="uppercase" fw={600} lts={0.5}>
                Edit Value
              </Text>
              <Flex gap="xs" align="center">
                <Switch
                  size="xs"
                  label="JSON"
                  checked={jsonMode || useJsonByDefault}
                  onChange={(e) => setJsonMode(e.currentTarget.checked)}
                  disabled={useJsonByDefault}
                />
                <ActionButton
                  size="sm"
                  variant="light"
                  tooltip="Reset to default"
                  onClick={() => {
                    const val = atom.defaultValue;
                    setEditValue(val);
                    setJsonText(JSON.stringify(val, null, 2));
                    setJsonError(null);
                  }}
                  icon={<IconRefresh size={14} />}
                />
                <ActionButton
                  size="xs"
                  icon={<IconDeviceFloppy size={14} />}
                  onClick={() => onSave(editValue)}
                  disabled={jsonMode && !!jsonError}
                >
                  Save
                </ActionButton>
              </Flex>
            </Flex>

            {jsonMode || useJsonByDefault ? (
              <Textarea
                value={jsonText}
                onChange={(e) => handleJsonChange(e.target.value)}
                autosize
                minRows={6}
                maxRows={20}
                error={jsonError ?? undefined}
                styles={{
                  input: { fontFamily: "monospace", fontSize: 12 },
                }}
              />
            ) : (
              <Flex
                p="sm"
                style={{
                  border: `1px solid ${ui.colors.border}`,
                  borderRadius: 8,
                  background: ui.colors.surface,
                }}
              >
                <SchemaEditor
                  schema={atom.schema}
                  value={editValue}
                  onChange={setEditValue}
                />
              </Flex>
            )}
          </Flex>

          {/* Schema info */}
          <Flex>
            <Text fz={10} c="dimmed" tt="uppercase" fw={600} lts={0.5} mb="xs">
              Schema
            </Text>
            <JsonViewer data={atom.schema} maxDepth={2} />
          </Flex>
        </Flex>
      </ScrollArea>
    </Flex>
  );
};

export const ConfigAtoms = () => {
  const http = useInject(HttpClient);
  const [atoms, setAtoms] = useState<DevAtomMetadata[]>([]);
  const [search, setSearch] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());

  const fetchAtoms = useCallback(() => {
    http
      .fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => {
        setAtoms(res.data.atoms);
        // Auto-expand top-level tree nodes
        const topLevelKeys = new Set<string>();
        for (const atom of res.data.atoms) {
          const first = atom.name.split(".")[0];
          topLevelKeys.add(`folder:${first}`);
        }
        setOpenNodes((prev) => (prev.size > 0 ? prev : topLevelKeys));
      })
      .catch(() => {});
  }, [http]);

  useEffect(() => {
    fetchAtoms();
  }, [fetchAtoms]);

  const filteredAtoms = useMemo(() => {
    if (!search) return atoms;
    const s = search.toLowerCase();
    return atoms.filter((a) => a.name.toLowerCase().includes(s));
  }, [atoms, search]);

  const tree = useMemo(() => buildAtomTree(filteredAtoms), [filteredAtoms]);

  const treeViewNodes = useMemo(() => tree.map(toTreeViewNode), [tree]);

  const selectedAtom = useMemo(
    () => atoms.find((a) => a.name === selectedName),
    [atoms, selectedName],
  );

  const handleSave = useCallback(
    async (value: any) => {
      if (!selectedAtom) return;
      try {
        await http.fetch("/__devtools/api/atoms", {
          method: "POST",
          body: JSON.stringify({ name: selectedAtom.name, value }),
        });
        fetchAtoms();
      } catch (error) {
        console.error("Failed to save atom:", error);
      }
    },
    [http, selectedAtom, fetchAtoms],
  );

  const handleToggle = useCallback((id: string) => {
    setOpenNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    // id is "atom:<name>"
    const name = id.replace(/^atom:/, "");
    setSelectedName(name);
  }, []);

  if (atoms.length === 0) {
    return (
      <Flex align="center" justify="center" style={{ flex: 1 }} c="dimmed">
        <Flex direction="column" align="center" gap="xs">
          <IconAtom size={40} opacity={0.3} />
          <Text fz="sm">No atoms found</Text>
          <Text fz="xs" c="dimmed">
            Use $atom primitive to define state atoms
          </Text>
        </Flex>
      </Flex>
    );
  }

  const selectedId = selectedName ? `atom:${selectedName}` : "";

  return (
    <Flex style={{ flex: 1, overflow: "hidden" }}>
      {/* Tree sidebar */}
      <Flex
        w={260}
        style={{
          borderRight: `1px solid ${ui.colors.border}`,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Flex p="xs" style={{ flexShrink: 0 }}>
          <TextInput
            placeholder="Search atoms..."
            leftSection={<IconSearch size={14} />}
            size="xs"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </Flex>
        <ScrollArea style={{ flex: 1 }} px="xs" pb="xs">
          <TreeView
            nodes={treeViewNodes}
            selectedId={selectedId}
            openNodes={openNodes}
            onSelect={handleSelect}
            onToggle={handleToggle}
          />
        </ScrollArea>
      </Flex>

      {/* Detail panel */}
      <Flex style={{ flex: 1, overflow: "hidden" }}>
        {selectedAtom ? (
          <AtomDetailPanel atom={selectedAtom} onSave={handleSave} />
        ) : (
          <Flex align="center" justify="center" h="100%">
            <Text c="dimmed" fz="sm">
              Select an atom to view its details
            </Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};
