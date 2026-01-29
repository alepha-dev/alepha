import { ui } from "@alepha/ui";
import { JsonViewer } from "@alepha/ui/json";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Flex,
  NumberInput,
  ScrollArea,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAtom,
  IconDeviceFloppy,
  IconEdit,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DevAtomMetadata } from "../../api/schemas/DevAtomMetadata.ts";
import { devMetadataSchema } from "../../api/schemas/DevMetadata.ts";

const AtomSidebar = ({
  atoms,
  selectedAtom,
  onSelectAtom,
  search,
  onSearchChange,
}: {
  atoms: DevAtomMetadata[];
  selectedAtom: DevAtomMetadata | null;
  onSelectAtom: (atom: DevAtomMetadata) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) => {
  return (
    <Stack gap={0} h="100%">
      <Box p="sm" style={{ borderBottom: `1px solid ${ui.colors.border}` }}>
        <TextInput
          placeholder="Search atoms..."
          leftSection={<IconSearch size={14} />}
          size="xs"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </Box>
      <ScrollArea style={{ flex: 1 }}>
        <Box>
          <Text
            size="xs"
            fw={600}
            c="dimmed"
            px="sm"
            py="xs"
            style={{
              backgroundColor: ui.colors.background,
              borderBottom: `1px solid ${ui.colors.border}`,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Atoms ({atoms.length})
          </Text>
          {atoms.map((atom) => {
            const isSelected = selectedAtom?.name === atom.name;
            const hasValue = atom.currentValue !== undefined;
            return (
              <Flex
                key={atom.name}
                align="center"
                gap="xs"
                px="sm"
                py={6}
                onClick={() => onSelectAtom(atom)}
                style={{
                  cursor: "pointer",
                  backgroundColor: isSelected ? "#228be615" : undefined,
                  borderLeft: isSelected
                    ? "2px solid #228be6"
                    : "2px solid transparent",
                  borderBottom: `1px solid ${ui.colors.border}`,
                }}
              >
                <IconAtom size={14} opacity={0.5} />
                <Text size="sm" style={{ flex: 1 }} truncate>
                  {atom.name}
                </Text>
                {hasValue && (
                  <Badge size="xs" variant="light" color="green">
                    set
                  </Badge>
                )}
              </Flex>
            );
          })}
        </Box>
      </ScrollArea>
    </Stack>
  );
};

// Simple schema-based editor for atom values
const SchemaEditor = ({
  schema,
  value,
  onChange,
  path = "",
}: {
  schema: any;
  value: any;
  onChange: (value: any) => void;
  path?: string;
}) => {
  if (!schema) return null;

  // Handle union types (optional)
  let actualSchema = schema;
  if (schema.anyOf) {
    const nonNull = schema.anyOf.find((t: any) => t.type !== "null");
    if (nonNull) actualSchema = nonNull;
  }

  const type = actualSchema.type;
  const format = actualSchema.format;

  // Object type
  if (type === "object" && actualSchema.properties) {
    return (
      <Stack gap="sm">
        {Object.entries(actualSchema.properties).map(
          ([key, propSchema]: [string, any]) => (
            <Box key={key}>
              <Text size="sm" fw={500} mb={4}>
                {propSchema.title || key}
                {propSchema.description && (
                  <Text span size="xs" c="dimmed" ml="xs">
                    {propSchema.description}
                  </Text>
                )}
              </Text>
              <SchemaEditor
                schema={propSchema}
                value={value?.[key]}
                onChange={(v) => onChange({ ...value, [key]: v })}
                path={path ? `${path}.${key}` : key}
              />
            </Box>
          ),
        )}
      </Stack>
    );
  }

  // Array type
  if (type === "array") {
    const items = value ?? [];
    return (
      <Stack gap="xs">
        {items.map((item: any, idx: number) => (
          <Flex key={idx} gap="xs" align="center">
            <Box style={{ flex: 1 }}>
              <SchemaEditor
                schema={actualSchema.items}
                value={item}
                onChange={(v) => {
                  const newItems = [...items];
                  newItems[idx] = v;
                  onChange(newItems);
                }}
                path={`${path}[${idx}]`}
              />
            </Box>
            <ActionIcon
              size="sm"
              variant="light"
              color="red"
              onClick={() => {
                const newItems = items.filter((_: any, i: number) => i !== idx);
                onChange(newItems);
              }}
            >
              <IconX size={14} />
            </ActionIcon>
          </Flex>
        ))}
        <Button
          size="xs"
          variant="light"
          onClick={() => onChange([...items, undefined])}
        >
          Add item
        </Button>
      </Stack>
    );
  }

  // Boolean
  if (type === "boolean") {
    return (
      <Switch
        checked={value ?? false}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    );
  }

  // Number/Integer
  if (type === "number" || type === "integer") {
    return (
      <NumberInput
        size="sm"
        value={value ?? ""}
        onChange={(v) => onChange(v === "" ? undefined : v)}
        allowDecimal={type === "number"}
      />
    );
  }

  // Enum
  if (actualSchema.enum) {
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        style={{
          padding: "6px 10px",
          borderRadius: 4,
          border: `1px solid ${ui.colors.border}`,
          backgroundColor: ui.colors.surface,
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

  // Date/DateTime
  if (format === "date" || format === "date-time") {
    return (
      <TextInput
        size="sm"
        type={format === "date" ? "date" : "datetime-local"}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  }

  // Long text (if format suggests or multiline)
  if (format === "textarea" || actualSchema.multiline) {
    return (
      <Textarea
        size="sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        autosize
        minRows={2}
        maxRows={6}
      />
    );
  }

  // Default: string
  return (
    <TextInput
      size="sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  );
};

const InfoTab = ({ atom }: { atom: DevAtomMetadata }) => {
  return (
    <ScrollArea h="100%" p="md">
      <Stack gap="lg">
        {/* Description */}
        {atom.description && (
          <Box>
            <Text size="sm" fw={600} mb="xs">
              Description
            </Text>
            <Text size="sm" c="dimmed">
              {atom.description}
            </Text>
          </Box>
        )}

        {/* Current Value */}
        <Box>
          <Text size="sm" fw={600} mb="xs">
            Current Value
          </Text>
          {atom.currentValue !== undefined ? (
            <JsonViewer data={atom.currentValue} maxDepth={3} />
          ) : (
            <Text size="sm" c="dimmed" fs="italic">
              (not set - using default)
            </Text>
          )}
        </Box>

        {/* Default Value */}
        <Box>
          <Text size="sm" fw={600} mb="xs">
            Default Value
          </Text>
          {atom.defaultValue !== undefined ? (
            <JsonViewer data={atom.defaultValue} maxDepth={3} />
          ) : (
            <Text size="sm" c="dimmed" fs="italic">
              (no default)
            </Text>
          )}
        </Box>

        {/* Schema */}
        <Box>
          <Text size="sm" fw={600} mb="xs">
            Schema
          </Text>
          <JsonViewer data={atom.schema} maxDepth={2} />
        </Box>
      </Stack>
    </ScrollArea>
  );
};

const EditTab = ({
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

  // Sync editValue when atom changes
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

  const handleSave = () => {
    onSave(editValue);
  };

  const handleReset = () => {
    const val = atom.defaultValue;
    setEditValue(val);
    setJsonText(JSON.stringify(val, null, 2));
    setJsonError(null);
  };

  return (
    <Flex direction="column" h="100%">
      <Box
        p="sm"
        style={{
          borderBottom: `1px solid ${ui.colors.border}`,
        }}
      >
        <Flex align="center" justify="space-between">
          <Flex gap="xs" align="center">
            <Switch
              size="xs"
              label="JSON mode"
              checked={jsonMode}
              onChange={(e) => setJsonMode(e.currentTarget.checked)}
            />
          </Flex>
          <Flex gap="xs">
            <Tooltip label="Reset to default">
              <ActionIcon
                size="sm"
                variant="light"
                color="gray"
                onClick={handleReset}
              >
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={handleSave}
              disabled={jsonMode && !!jsonError}
            >
              Save
            </Button>
          </Flex>
        </Flex>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        {jsonMode ? (
          <Stack gap="xs">
            <Textarea
              value={jsonText}
              onChange={(e) => handleJsonChange(e.target.value)}
              autosize
              minRows={10}
              maxRows={20}
              error={jsonError}
              styles={{
                input: {
                  fontFamily: "monospace",
                },
              }}
            />
            {jsonError && (
              <Text size="xs" c="red">
                {jsonError}
              </Text>
            )}
          </Stack>
        ) : (
          <SchemaEditor
            schema={atom.schema}
            value={editValue}
            onChange={setEditValue}
          />
        )}
      </ScrollArea>
    </Flex>
  );
};

const AtomPanel = ({
  atom,
  onSave,
}: {
  atom: DevAtomMetadata;
  onSave: (atom: DevAtomMetadata, value: any) => void;
}) => {
  const hasValue = atom.currentValue !== undefined;

  return (
    <Flex direction="column" h="100%">
      {/* Header */}
      <Box
        px="md"
        py="sm"
        style={{
          borderBottom: `1px solid ${ui.colors.border}`,
          backgroundColor: "#228be608",
        }}
      >
        <Flex align="center" gap="sm">
          <IconAtom size={18} opacity={0.7} />
          <Text size="md" fw={600}>
            {atom.name}
          </Text>
          <Badge size="xs" variant="light" color={hasValue ? "green" : "gray"}>
            {hasValue ? "has value" : "default"}
          </Badge>
        </Flex>
      </Box>

      {/* Tabs */}
      <Tabs
        defaultValue="info"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
      >
        <Tabs.List px="md">
          <Tabs.Tab value="info">Info</Tabs.Tab>
          <Tabs.Tab value="edit" leftSection={<IconEdit size={14} />}>
            Edit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="info" style={{ flex: 1, overflow: "hidden" }}>
          <InfoTab atom={atom} />
        </Tabs.Panel>

        <Tabs.Panel value="edit" style={{ flex: 1, overflow: "hidden" }}>
          <EditTab atom={atom} onSave={(value) => onSave(atom, value)} />
        </Tabs.Panel>
      </Tabs>
    </Flex>
  );
};

const EmptyState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconAtom size={48} opacity={0.3} />
      <Text size="sm">Select an atom to view its details</Text>
    </Stack>
  </Flex>
);

const NoAtomsState = () => (
  <Flex align="center" justify="center" h="100%" c="dimmed">
    <Stack align="center" gap="xs">
      <IconAtom size={48} opacity={0.3} />
      <Text>No atoms found</Text>
      <Text size="sm" c="dimmed">
        Use $atom primitive to define state atoms
      </Text>
    </Stack>
  </Flex>
);

export const DevAtomsViewer = () => {
  const http = useInject(HttpClient);
  const [atoms, setAtoms] = useState<DevAtomMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAtom, setSelectedAtom] = useState<DevAtomMetadata | null>(
    null,
  );
  const [search, setSearch] = useState("");

  const fetchAtoms = useCallback(() => {
    http
      .fetch("/devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => {
        setAtoms(res.data.atoms);
        setLoading(false);

        // Update selected atom if it exists
        if (selectedAtom) {
          const updated = res.data.atoms.find(
            (a) => a.name === selectedAtom.name,
          );
          if (updated) setSelectedAtom(updated);
        }
      });
  }, [selectedAtom?.name]);

  useEffect(() => {
    fetchAtoms();
  }, []);

  const filteredAtoms = useMemo(() => {
    if (!search) return atoms;
    const searchLower = search.toLowerCase();
    return atoms.filter((a) => a.name.toLowerCase().includes(searchLower));
  }, [atoms, search]);

  const handleSave = useCallback(
    async (atom: DevAtomMetadata, value: any) => {
      // POST to update atom value
      try {
        await http.fetch("/devtools/api/atoms", {
          method: "POST",
          body: JSON.stringify({ name: atom.name, value }),
        });
        // Refresh data
        fetchAtoms();
      } catch (error) {
        console.error("Failed to save atom:", error);
      }
    },
    [fetchAtoms],
  );

  if (loading) {
    return (
      <Flex align="center" justify="center" h="100%">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  if (atoms.length === 0) {
    return <NoAtomsState />;
  }

  return (
    <Flex h="100%" style={{ overflow: "hidden" }}>
      {/* Sidebar */}
      <Box
        w={260}
        style={{
          borderRight: `1px solid ${ui.colors.border}`,
          backgroundColor: ui.colors.surface,
        }}
      >
        <AtomSidebar
          atoms={filteredAtoms}
          selectedAtom={selectedAtom}
          onSelectAtom={setSelectedAtom}
          search={search}
          onSearchChange={setSearch}
        />
      </Box>

      {/* Main content */}
      <Box style={{ flex: 1, overflow: "hidden" }}>
        {selectedAtom ? (
          <AtomPanel atom={selectedAtom} onSave={handleSave} />
        ) : (
          <EmptyState />
        )}
      </Box>
    </Flex>
  );
};

export default DevAtomsViewer;
