import type { DevAtomMetadata } from "@alepha/devtools";
import { devMetadataSchema } from "@alepha/devtools";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { Switch } from "@alepha/ui/components/ui/switch";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { Atom, RefreshCw, Save, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TreeView, type TreeViewNode } from "../shared/TreeView.tsx";
import { ConfigAtomsMutations } from "./ConfigAtomsMutations.tsx";

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
      <Atom className="size-3 shrink-0 text-violet-500" />
    ) : undefined,
    badge:
      isLeaf && node.atom?.currentValue !== undefined ? (
        <Badge variant="default" className="text-[10px]">
          set
        </Badge>
      ) : undefined,
    children:
      node.children.length > 0 ? node.children.map(toTreeViewNode) : undefined,
  };
};

interface SchemaEditorProps {
  schema: any;
  value: any;
  onChange: (value: any) => void;
}

const SchemaEditor = (props: SchemaEditorProps) => {
  if (!props.schema) return null;

  let actualSchema = props.schema;
  if (props.schema.anyOf) {
    const nonNull = props.schema.anyOf.find((tt: any) => tt.type !== "null");
    if (nonNull) actualSchema = nonNull;
  }

  const type = actualSchema.type;

  if (type === "object" && actualSchema.properties) {
    return (
      <div className="flex flex-col gap-3">
        {Object.entries(actualSchema.properties).map(
          ([key, propSchema]: [string, any]) => (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-xs font-medium">
                {propSchema.title || key}
                {propSchema.description && (
                  <span className="text-muted-foreground ml-2 text-[10px]">
                    {propSchema.description}
                  </span>
                )}
              </span>
              <SchemaEditor
                schema={propSchema}
                value={props.value?.[key]}
                onChange={(v) => props.onChange({ ...props.value, [key]: v })}
              />
            </div>
          ),
        )}
      </div>
    );
  }

  if (type === "boolean") {
    return (
      <Switch
        checked={props.value ?? false}
        onCheckedChange={(checked) => props.onChange(checked)}
      />
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <Input
        type="number"
        className="h-8 text-xs"
        value={props.value ?? ""}
        onChange={(e) =>
          props.onChange(
            e.target.value === "" ? undefined : Number(e.target.value),
          )
        }
      />
    );
  }

  if (actualSchema.enum) {
    return (
      <Select
        value={props.value ?? ""}
        onValueChange={(v) => props.onChange(v || undefined)}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {actualSchema.enum.map((opt: string) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      className="h-8 text-xs"
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value || undefined)}
    />
  );
};

interface AtomDetailPanelProps {
  atom: DevAtomMetadata;
  onSave: (value: any) => void;
}

const AtomDetailPanel = (props: AtomDetailPanelProps) => {
  const { atom, onSave } = props;
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
    <div className="flex h-full w-full flex-col">
      <div className="border-border flex shrink-0 flex-col gap-1 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Atom className="size-4 opacity-50" />
          <span className="font-mono text-sm font-semibold">{atom.name}</span>
          <Badge variant={hasValue ? "default" : "secondary"}>
            {hasValue ? "has value" : "default"}
          </Badge>
        </div>
        {atom.description && (
          <p className="text-muted-foreground text-xs">{atom.description}</p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-6">
            <div className="min-w-[200px] flex-1">
              <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wider">
                Current Value
              </p>
              {atom.currentValue !== undefined ? (
                <pre className="bg-muted overflow-auto rounded p-2 text-xs">
                  {JSON.stringify(atom.currentValue, null, 2)}
                </pre>
              ) : (
                <p className="text-muted-foreground text-xs italic">
                  (using default)
                </p>
              )}
            </div>
            <div className="min-w-[200px] flex-1">
              <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wider">
                Default Value
              </p>
              {atom.defaultValue !== undefined ? (
                <pre className="bg-muted overflow-auto rounded p-2 text-xs">
                  {JSON.stringify(atom.defaultValue, null, 2)}
                </pre>
              ) : (
                <p className="text-muted-foreground text-xs italic">
                  (no default)
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                Edit Value
              </p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs">
                  <Switch
                    checked={jsonMode || useJsonByDefault}
                    disabled={useJsonByDefault}
                    onCheckedChange={(checked) => setJsonMode(checked)}
                  />
                  JSON
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const val = atom.defaultValue;
                    setEditValue(val);
                    setJsonText(JSON.stringify(val, null, 2));
                    setJsonError(null);
                  }}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  onClick={() => onSave(editValue)}
                  disabled={jsonMode && !!jsonError}
                >
                  <Save className="size-3.5" />
                  Save
                </Button>
              </div>
            </div>

            {jsonMode || useJsonByDefault ? (
              <>
                <Textarea
                  className="font-mono text-xs"
                  rows={8}
                  value={jsonText}
                  onChange={(e) => handleJsonChange(e.target.value)}
                />
                {jsonError && (
                  <p className="text-destructive text-xs">{jsonError}</p>
                )}
              </>
            ) : (
              <div className="bg-card border-border rounded-lg border p-3">
                <SchemaEditor
                  schema={atom.schema}
                  value={editValue}
                  onChange={setEditValue}
                />
              </div>
            )}
          </div>

          <div>
            <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wider">
              Schema
            </p>
            <pre className="bg-muted overflow-auto rounded p-2 text-xs">
              {JSON.stringify(atom.schema, null, 2)}
            </pre>
          </div>

          <ConfigAtomsMutations atomName={atom.name} />
        </div>
      </div>
    </div>
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
    const name = id.replace(/^atom:/, "");
    setSelectedName(name);
  }, []);

  if (atoms.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Atom className="size-10 opacity-30" />
          <p className="text-sm">No atoms found</p>
          <p className="text-xs">Use $atom primitive to define state atoms</p>
        </div>
      </div>
    );
  }

  const selectedId = selectedName ? `atom:${selectedName}` : "";

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="border-border flex w-[260px] shrink-0 flex-col border-r">
        <div className="flex shrink-0 p-2">
          <div className="relative w-full">
            <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search atoms..."
              className="h-8 pl-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto px-2 pb-2">
          <TreeView
            nodes={treeViewNodes}
            selectedId={selectedId}
            openNodes={openNodes}
            onSelect={handleSelect}
            onToggle={handleToggle}
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {selectedAtom ? (
          <AtomDetailPanel atom={selectedAtom} onSave={handleSave} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-muted-foreground text-sm">
              Select an atom to view its details
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
