import { ActionButton, TypeForm, ui } from "@alepha/ui";
import {
  Badge,
  Box,
  Flex,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  IconDatabase,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { jsonSchemaToTypeBox, t } from "alepha";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useRouter } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TreeView, type TreeViewNode } from "../shared/TreeView.tsx";

const EMPTY_SCHEMA = t.object({});

const toTypeBoxSchema = (jsonSchema: any): any => {
  if (!jsonSchema) return null;
  try {
    const converted = jsonSchemaToTypeBox(jsonSchema);
    if (converted?.properties) return converted;
  } catch {
    // Schema conversion failed
  }
  return null;
};

const RecordForm = ({
  entity,
  record,
  isNew,
  onSave,
  onDelete,
  pkColumn,
}: {
  entity: any;
  record: any;
  isNew: boolean;
  onSave: (values: any) => void;
  onDelete: () => void;
  pkColumn: string;
}) => {
  const schema = useMemo(() => {
    const jsonSchema = isNew ? entity.insertSchema : entity.updateSchema;
    return toTypeBoxSchema(jsonSchema) ?? EMPTY_SCHEMA;
  }, [entity, isNew]);

  const form = useForm(
    {
      schema,
      handler: () => {},
      initialValues: isNew ? undefined : record,
    },
    [schema, record, isNew],
  );

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fz="sm" fw={600}>
          {isNew
            ? "New Record"
            : `Edit Record (${pkColumn}: ${record?.[pkColumn]})`}
        </Text>
        <Group gap="xs">
          <ActionButton size="xs" onClick={() => onSave(form.currentValues)}>
            {isNew ? "Create" : "Save"}
          </ActionButton>
          {!isNew && (
            <ActionButton
              size="sm"
              variant="light"
              intent="danger"
              onClick={onDelete}
              icon={<IconTrash size={14} />}
            />
          )}
        </Group>
      </Group>
      <TypeForm form={form} skipSubmitButton skipFormElement columns={1} />
    </Stack>
  );
};

/** Parse /db/editor/:table/:id from pathname */
const parseEditorPath = (pathname: string) => {
  const prefix = "/db/editor/";
  if (!pathname.startsWith(prefix)) return { table: "", recordId: "" };
  const rest = pathname.slice(prefix.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) return { table: decodeURIComponent(rest), recordId: "" };
  return {
    table: decodeURIComponent(rest.slice(0, slashIdx)),
    recordId: decodeURIComponent(rest.slice(slashIdx + 1)),
  };
};

export const DatabaseEditor = ({ entities }: { entities: any[] }) => {
  const http = useInject(HttpClient);
  const router = useRouter();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [pageInfo, setPageInfo] = useState<any>(null);

  const { table: selectedEntity, recordId } = parseEditorPath(router.pathname);
  const isNew = recordId === "new";

  const entity = entities.find((e) => e.name === selectedEntity);
  const pkColumn =
    entity?.columns?.find((c: any) => c.primaryKey)?.name ?? "id";

  const fetchRecords = useCallback(async () => {
    if (!selectedEntity) return;
    setLoading(true);
    try {
      const res = await http.fetch(
        `/__devtools/api/db/${selectedEntity}/records?size=50`,
      );
      setRecords((res.data as any)?.content ?? []);
      setPageInfo((res.data as any)?.page);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [http, selectedEntity]);

  useEffect(() => {
    fetchRecords();
  }, [selectedEntity, fetchRecords]);

  const selectedRecord = useMemo(() => {
    if (!recordId || isNew) return null;
    return records.find((r) => String(r[pkColumn]) === recordId) ?? null;
  }, [records, recordId, isNew, pkColumn]);

  const navigateToEntity = useCallback(
    (name: string) => {
      router.push(`/db/editor/${encodeURIComponent(name)}`);
    },
    [router],
  );

  const navigateToRecord = useCallback(
    (record: any) => {
      const id = record[pkColumn];
      router.push(
        `/db/editor/${encodeURIComponent(selectedEntity)}/${encodeURIComponent(String(id))}`,
      );
    },
    [router, selectedEntity, pkColumn],
  );

  const navigateToNew = useCallback(() => {
    router.push(`/db/editor/${encodeURIComponent(selectedEntity)}/new`);
  }, [router, selectedEntity]);

  const handleSave = async (data: any) => {
    try {
      if (isNew) {
        await http.fetch(`/__devtools/api/db/${selectedEntity}/records`, {
          method: "POST",
          body: JSON.stringify(data),
          headers: { "Content-Type": "application/json" },
        });
        router.push(`/db/editor/${encodeURIComponent(selectedEntity)}`);
      } else if (selectedRecord) {
        const idValue = selectedRecord[pkColumn];
        await http.fetch(
          `/__devtools/api/db/${selectedEntity}/records/${idValue}`,
          {
            method: "PUT",
            body: JSON.stringify(data),
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      await fetchRecords();
    } catch {
      // handle error
    }
  };

  const handleDelete = async () => {
    if (!selectedRecord) return;
    const idValue = selectedRecord[pkColumn];
    try {
      await http.fetch(
        `/__devtools/api/db/${selectedEntity}/records/${idValue}`,
        { method: "DELETE" },
      );
      router.push(`/db/editor/${encodeURIComponent(selectedEntity)}`);
      await fetchRecords();
    } catch {
      // handle error
    }
  };

  const entityNodes: TreeViewNode[] = useMemo(() => {
    const filtered = entities.filter((e) =>
      e.name.toLowerCase().includes(search.toLowerCase()),
    );
    return filtered.map((e) => ({
      id: `entity:${e.name}`,
      label: e.name,
      icon: (
        <IconDatabase
          size={13}
          color="var(--mantine-color-blue-text)"
          style={{ flexShrink: 0 }}
        />
      ),
      badge: (
        <Badge size="xs" variant="light" color="gray">
          {e.columns?.length ?? 0}
        </Badge>
      ),
    }));
  }, [entities, search]);

  const handleEntitySelect = useCallback(
    (id: string) => {
      const name = id.replace(/^entity:/, "");
      navigateToEntity(name);
    },
    [navigateToEntity],
  );

  const emptyOpenNodes = useMemo(() => new Set<string>(), []);
  const selectedEntityId = selectedEntity ? `entity:${selectedEntity}` : "";

  return (
    <Flex style={{ flex: 1, overflow: "hidden" }}>
      {/* Entity list */}
      <Box
        w={200}
        style={{
          borderRight: `1px solid ${ui.colors.border}`,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box p="xs">
          <TextInput
            size="xs"
            placeholder="Filter tables..."
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </Box>
        <ScrollArea style={{ flex: 1 }} px="xs">
          <TreeView
            nodes={entityNodes}
            selectedId={selectedEntityId}
            openNodes={emptyOpenNodes}
            onSelect={handleEntitySelect}
            onToggle={() => {}}
            showLeafCount={false}
          />
        </ScrollArea>
      </Box>

      {/* Records list */}
      {selectedEntity && (
        <Box
          w={200}
          style={{
            borderRight: `1px solid ${ui.colors.border}`,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box
            px="xs"
            py="xs"
            style={{
              borderBottom: `1px solid ${ui.colors.border}`,
              flexShrink: 0,
            }}
          >
            <Group gap="xs" justify="space-between">
              <Text fz={10} c="dimmed" tt="uppercase" fw={600} lts={0.5}>
                Records{" "}
                {pageInfo?.totalElements != null &&
                  `(${pageInfo.totalElements})`}
              </Text>
              <ActionButton
                size="xs"
                variant="subtle"
                color="teal"
                onClick={navigateToNew}
                icon={<IconPlus size={14} />}
              />
            </Group>
          </Box>
          <ScrollArea style={{ flex: 1 }} px="xs" py="xs">
            <UnstyledButton
              w="100%"
              py={4}
              className="devtools-tree-node"
              data-selected={isNew || undefined}
              style={{
                borderRadius: 6,
                paddingLeft: 8,
                paddingRight: 8,
                transition: "background 100ms ease",
              }}
              onClick={navigateToNew}
            >
              <Group gap={8} wrap="nowrap">
                <IconPlus
                  size={13}
                  color="var(--mantine-color-teal-text)"
                  style={{ flexShrink: 0 }}
                />
                <Text fz={12} c="teal">
                  New Record
                </Text>
              </Group>
            </UnstyledButton>
            {loading ? (
              <Flex justify="center" py="md">
                <Loader size="xs" />
              </Flex>
            ) : (
              records.map((record, i) => {
                const idVal = record[pkColumn] ?? i;
                const isActive = !isNew && String(idVal) === recordId;
                return (
                  <UnstyledButton
                    key={String(idVal)}
                    w="100%"
                    py={4}
                    className="devtools-tree-node"
                    data-selected={isActive || undefined}
                    style={{
                      borderRadius: 6,
                      paddingLeft: 8,
                      paddingRight: 8,
                      transition: "background 100ms ease",
                    }}
                    onClick={() => navigateToRecord(record)}
                  >
                    <Text fz={12} ff="monospace" truncate>
                      {pkColumn}: {String(idVal)}
                    </Text>
                  </UnstyledButton>
                );
              })
            )}
          </ScrollArea>
        </Box>
      )}

      {/* Editor panel */}
      <Box style={{ flex: 1, overflow: "auto" }} p="md">
        {!selectedEntity && (
          <Flex align="center" justify="center" h="100%">
            <Text c="dimmed" fz="sm">
              Select a table to browse records
            </Text>
          </Flex>
        )}

        {selectedEntity && !selectedRecord && !isNew && (
          <Flex align="center" justify="center" h="100%">
            <Text c="dimmed" fz="sm">
              Select a record or create a new one
            </Text>
          </Flex>
        )}

        {(selectedRecord || isNew) && entity && (
          <RecordForm
            entity={entity}
            record={selectedRecord}
            isNew={isNew}
            onSave={handleSave}
            onDelete={handleDelete}
            pkColumn={pkColumn}
          />
        )}
      </Box>
    </Flex>
  );
};
