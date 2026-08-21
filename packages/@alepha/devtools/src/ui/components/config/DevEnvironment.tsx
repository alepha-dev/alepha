import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import type { DevEnvMetadata } from "../../../schemas/DevEnvMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { EnvLine } from "./EnvLine.tsx";

export interface EnvVariable {
  name: string;
  value: unknown;
  type: string;
  format?: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  /**
   * The module (falling back to the service) that declared this variable.
   */
  source: string;
}

const parse = (envs: DevEnvMetadata[]): EnvVariable[] => {
  const map = new Map<string, EnvVariable>();

  for (const env of envs) {
    const schema: any = env.schema;
    if (!schema?.properties) continue;
    const required: string[] = Array.isArray(schema.required)
      ? schema.required
      : [];

    for (const [name, raw] of Object.entries<any>(schema.properties)) {
      if (map.has(name)) continue;
      let prop = raw;
      if (Array.isArray(prop?.anyOf)) {
        prop = prop.anyOf.find((p: any) => p?.type !== "null") ?? prop;
      }
      map.set(name, {
        name,
        value: env.values?.[name],
        type: prop?.type ?? "unknown",
        format: prop?.format,
        description: prop?.description,
        required: required.includes(name),
        defaultValue: prop?.default,
        source: env.moduleName ?? env.serviceName ?? "application",
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
};

export const DevEnvironment = () => {
  const meta = useMetadata();
  const [search, setSearch] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);

  const variables = useMemo(() => parse(meta.data?.envs ?? []), [meta.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variables;
    return variables.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.description?.toLowerCase().includes(q),
    );
  }, [variables, search]);

  /**
   * Grouped by declaring module so the list reads like a set of `.env`
   * sections rather than one undifferentiated wall of names.
   */
  const grouped = useMemo(() => {
    const map = new Map<string, EnvVariable[]>();
    for (const v of visible) {
      if (!map.has(v.source)) map.set(v.source, []);
      map.get(v.source)!.push(v);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const missing = variables.filter(
    (v) => v.required && (v.value === undefined || v.value === ""),
  ).length;

  if (meta.error) {
    return (
      <DevError what="environment" message={meta.error} onRetry={meta.reload} />
    );
  }

  if (!meta.loading && variables.length === 0) {
    return (
      <DevEmpty
        title="No environment variables declared"
        hint="Use $env to declare the variables your application expects"
      />
    );
  }

  const copyAll = () => {
    const text = visible.map((v) => `${v.name}=${v.value ?? ""}`).join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
      }}
    >
      <div className="dt-toolbar">
        <input
          className="dt-input"
          style={{ width: 240 }}
          placeholder="Search variables…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <span className="dt-chip">
          {visible.length} / {variables.length}
        </span>
        {missing > 0 && (
          <span
            className="dt-chip"
            style={{
              color: "var(--dt-warn)",
              borderColor: "var(--dt-warn)",
            }}
          >
            {missing} required unset
          </span>
        )}
        <span style={{ marginLeft: "auto" }} />
        <button type="button" className="dt-btn" onClick={copyAll}>
          {copiedAll ? <Check size={11} /> : <Copy size={11} />}
          Copy as .env
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {grouped.map(([source, vars]) => (
          <div key={source}>
            <div className="dt-env-group"># {source}</div>
            {vars.map((v) => (
              <EnvLine key={v.name} variable={v} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DevEnvironment;
