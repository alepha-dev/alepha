import type { DevEnvMetadata } from "@alepha/devtools";
import { devMetadataSchema } from "@alepha/devtools";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { Check, Copy, Search, Variable } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface EnvVariable {
  name: string;
  value: any;
  type: string;
  description?: string;
  format?: string;
}

const SENSITIVE_PATTERNS = ["secret", "password", "key", "token", "api_key"];

const isSensitive = (name: string): boolean => {
  const lower = name.toLowerCase();
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p));
};

const parseEnvVariables = (envs: DevEnvMetadata[]): EnvVariable[] => {
  const variableMap = new Map<string, EnvVariable>();

  for (const env of envs) {
    const schema = env.schema;
    if (!schema?.properties) continue;

    for (const [name, propSchema] of Object.entries(schema.properties)) {
      if (variableMap.has(name)) continue;

      const prop = propSchema as any;
      const value = env.values[name];

      let type = prop.type ?? "unknown";
      let format = prop.format;

      if (prop.anyOf) {
        const nonNull = prop.anyOf.find((tt: any) => tt.type !== "null");
        if (nonNull) {
          type = nonNull.type ?? "unknown";
          format = nonNull.format;
        }
      }

      variableMap.set(name, {
        name,
        value,
        type,
        description: prop.description,
        format,
      });
    }
  }

  return Array.from(variableMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
};

interface CopyIconProps {
  value: string;
}

const CopyIcon = (props: CopyIconProps) => {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    navigator.clipboard.writeText(props.value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className={`shrink-0 ml-1.5 ${copied ? "text-teal-500" : "text-muted-foreground"}`}
          />
        }
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
    </Tooltip>
  );
};

interface EnvLineProps {
  variable: EnvVariable;
}

const EnvLine = (props: EnvLineProps) => {
  const variable = props.variable;
  const hasValue = variable.value !== undefined && variable.value !== "";
  const displayValue = hasValue ? String(variable.value) : "";
  const sensitive = isSensitive(variable.name);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex flex-col">
      {variable.description?.split("\n").map((line, i) => (
        <span
          key={i}
          className="text-muted-foreground font-mono text-[11px] italic leading-relaxed"
        >
          # {line}
        </span>
      ))}
      <div className="flex items-center leading-relaxed">
        <span className="font-mono text-xs font-semibold text-teal-500">
          {variable.name}
        </span>
        <span className="text-muted-foreground font-mono text-xs">=</span>
        {hasValue ? (
          <span
            className="font-mono text-xs transition-all"
            style={{
              filter: sensitive && !revealed ? "blur(4px)" : undefined,
              cursor: sensitive ? "pointer" : undefined,
            }}
            onMouseEnter={() => sensitive && setRevealed(true)}
            onMouseLeave={() => sensitive && setRevealed(false)}
          >
            {displayValue}
          </span>
        ) : (
          <span className="text-muted-foreground font-mono text-xs italic">
            (not set)
          </span>
        )}
        <Badge variant="outline" className="ml-2 shrink-0 text-[10px]">
          {variable.format || variable.type}
        </Badge>
        {hasValue && <CopyIcon value={String(variable.value)} />}
      </div>
    </div>
  );
};

export const ConfigEnv = () => {
  const http = useInject(HttpClient);
  const [envs, setEnvs] = useState<DevEnvMetadata[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    http
      .fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => setEnvs(res.data.envs))
      .catch(() => {});
  }, [http]);

  const variables = useMemo(() => parseEnvVariables(envs), [envs]);

  const filtered = useMemo(() => {
    if (!search) return variables;
    const s = search.toLowerCase();
    return variables.filter(
      (v) =>
        v.name.toLowerCase().includes(s) ||
        v.description?.toLowerCase().includes(s),
    );
  }, [variables, search]);

  if (variables.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Variable className="size-10 opacity-30" />
          <p className="text-sm">No environment variables found</p>
          <p className="text-xs">
            Use $env primitive to define expected environment variables
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-border flex shrink-0 items-center gap-3 border-b p-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Search variables..."
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
        <Badge variant="secondary">
          {filtered.length} / {variables.length}
        </Badge>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-card border-border rounded-lg border p-4">
          <div className="flex flex-col gap-2">
            {filtered.map((v) => (
              <EnvLine key={v.name} variable={v} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
