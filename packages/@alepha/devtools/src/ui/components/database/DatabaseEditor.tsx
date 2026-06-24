import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { jsonSchemaToZod, z } from "alepha";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useRouter, useRouterState } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import { Database, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TreeView, type TreeViewNode } from "../shared/TreeView.tsx";

const EMPTY_SCHEMA = z.object({});

const toTypeBoxSchema = (jsonSchema: any): any => {
  if (!jsonSchema) return null;
  try {
    const converted = jsonSchemaToZod(jsonSchema);
    if (converted && z.schema.isObject(converted)) return converted;
  } catch {
    // ignore
  }
  return null;
};

interface RecordFormProps {
  entity: any;
  record: any;
  isNew: boolean;
  onSave: (values: any) => void;
  onDelete: () => void;
  pkColumn: string;
}

const RecordForm = (props: RecordFormProps) => {
  const schema = useMemo(() => {
    const jsonSchema = props.isNew
      ? props.entity.insertSchema
      : props.entity.updateSchema;
    return toTypeBoxSchema(jsonSchema) ?? EMPTY_SCHEMA;
  }, [props.entity, props.isNew]);

  const form = useForm(
    {
      schema,
      handler: () => {},
      initialValues: props.isNew ? undefined : props.record,
    },
    [schema, props.record, props.isNew],
  );

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">
          {props.isNew
            ? "New Record"
            : `Edit Record (${props.pkColumn}: ${props.record?.[props.pkColumn]})`}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => props.onSave(form.currentValues)}>
            {props.isNew ? "Create" : "Save"}
          </Button>
          {!props.isNew && (
            <Button size="sm" variant="destructive" onClick={props.onDelete}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <AutoForm form={form} noSubmit />
    </div>
  );
};

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

interface DatabaseEditorProps {
  entities: any[];
}

export const DatabaseEditor = (props: DatabaseEditorProps) => {
  const entities = props.entities;
  const http = useInject(HttpClient);
  const router = useRouter();
  const state = useRouterState();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [pageInfo, setPageInfo] = useState<any>(null);

  const { table: selectedEntity, recordId } = parseEditorPath(
    state.url.pathname,
  );
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
      // ignore
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
      // ignore
    }
  };

  const entityNodes: TreeViewNode[] = useMemo(() => {
    const filtered = entities.filter((e) =>
      e.name.toLowerCase().includes(search.toLowerCase()),
    );
    return filtered.map((e) => ({
      id: `entity:${e.name}`,
      label: e.name,
      icon: <Database className="size-3 shrink-0 text-blue-500" />,
      badge: (
        <Badge variant="secondary" className="text-[10px]">
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
    <div className="flex flex-1 overflow-hidden">
      {/* Entity list */}
      <div className="border-border flex w-[200px] shrink-0 flex-col border-r">
        <div className="flex p-2">
          <div className="relative w-full">
            <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Filter tables..."
              className="h-8 pl-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto px-2">
          <TreeView
            nodes={entityNodes}
            selectedId={selectedEntityId}
            openNodes={emptyOpenNodes}
            onSelect={handleEntitySelect}
            onToggle={() => {}}
            showLeafCount={false}
          />
        </div>
      </div>

      {/* Records list */}
      {selectedEntity && (
        <div className="border-border flex w-[200px] shrink-0 flex-col border-r">
          <div className="border-border flex shrink-0 items-center justify-between border-b px-2 py-2">
            <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
              Records{" "}
              {pageInfo?.totalElements != null && `(${pageInfo.totalElements})`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="size-6 p-0"
              onClick={navigateToNew}
            >
              <Plus className="size-3.5 text-teal-500" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto px-2 py-2">
            <button
              type="button"
              data-selected={isNew || undefined}
              className="hover:bg-muted/50 data-[selected=true]:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1 transition-colors"
              onClick={navigateToNew}
            >
              <Plus className="size-3 shrink-0 text-teal-500" />
              <span className="text-xs text-teal-500">New Record</span>
            </button>
            {loading ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Loading...
              </p>
            ) : (
              records.map((record, i) => {
                const idVal = record[pkColumn] ?? i;
                const isActive = !isNew && String(idVal) === recordId;
                return (
                  <button
                    type="button"
                    key={String(idVal)}
                    data-selected={isActive || undefined}
                    className="hover:bg-muted/50 data-[selected=true]:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1 transition-colors"
                    onClick={() => navigateToRecord(record)}
                  >
                    <span className="truncate font-mono text-xs">
                      {pkColumn}: {String(idVal)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Editor panel */}
      <div className="flex flex-1 overflow-auto p-4">
        {!selectedEntity && (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-muted-foreground text-sm">
              Select a table to browse records
            </span>
          </div>
        )}

        {selectedEntity && !selectedRecord && !isNew && (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-muted-foreground text-sm">
              Select a record or create a new one
            </span>
          </div>
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
      </div>
    </div>
  );
};
