import type { DevEnvMetadata } from "@alepha/devtools";
import { devMetadataSchema } from "@alepha/devtools";
import { Flex, ui } from "@alepha/mantine";
import {
  Badge,
  Code,
  CopyButton,
  ScrollArea,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconSearch,
  IconVariable,
} from "@tabler/icons-react";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
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
        const nonNull = prop.anyOf.find((t: any) => t.type !== "null");
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

const EnvLine = ({ variable }: { variable: EnvVariable }) => {
  const hasValue = variable.value !== undefined && variable.value !== "";
  const displayValue = hasValue ? String(variable.value) : "";
  const sensitive = isSensitive(variable.name);

  return (
    <Flex direction="column">
      {/* Description as comment */}
      {variable.description?.split("\n").map((line, i) => (
        <Text key={i} fz={11} ff="monospace" c="dimmed" fs="italic" lh={1.6}>
          # {line}
        </Text>
      ))}
      <Flex align="center" gap={0} style={{ lineHeight: 1.6 }}>
        <Text fz={12} ff="monospace" fw={600} c="teal.5" component="span">
          {variable.name}
        </Text>
        <Text fz={12} ff="monospace" c="dimmed" component="span">
          =
        </Text>
        {hasValue ? (
          <Text
            fz={12}
            ff="monospace"
            component="span"
            style={{
              filter: sensitive ? "blur(4px)" : undefined,
              transition: "filter 150ms",
              cursor: sensitive ? "pointer" : undefined,
            }}
            onMouseEnter={(e) => {
              if (sensitive) e.currentTarget.style.filter = "none";
            }}
            onMouseLeave={(e) => {
              if (sensitive) e.currentTarget.style.filter = "blur(4px)";
            }}
          >
            {displayValue}
          </Text>
        ) : (
          <Text fz={12} ff="monospace" c="dimmed" fs="italic" component="span">
            (not set)
          </Text>
        )}
        <Badge
          size="xs"
          variant="dot"
          color="gray"
          ml="sm"
          style={{ flexShrink: 0 }}
        >
          {variable.format || variable.type}
        </Badge>
        {hasValue && (
          <CopyButton value={String(variable.value)}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                <Flex
                  ml={6}
                  onClick={copy}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                  c={copied ? "teal" : "dimmed"}
                >
                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                </Flex>
              </Tooltip>
            )}
          </CopyButton>
        )}
      </Flex>
    </Flex>
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
      <Flex align="center" justify="center" style={{ flex: 1 }} c="dimmed">
        <Flex direction="column" align="center" gap="xs">
          <IconVariable size={40} opacity={0.3} />
          <Text fz="sm">No environment variables found</Text>
          <Text fz="xs" c="dimmed">
            Use $env primitive to define expected environment variables
          </Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex direction="column" style={{ flex: 1 }}>
      <Flex
        p="sm"
        style={{ borderBottom: `1px solid ${ui.colors.border}`, flexShrink: 0 }}
      >
        <Flex gap="sm" align="center">
          <TextInput
            placeholder="Search variables..."
            leftSection={<IconSearch size={14} />}
            size="xs"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1, maxWidth: 340 }}
          />
          <Badge variant="light" color="gray" size="sm">
            {filtered.length} / {variables.length}
          </Badge>
        </Flex>
      </Flex>
      <ScrollArea style={{ flex: 1 }} p="md">
        <Code
          block
          style={{
            background: ui.colors.surface,
            border: `1px solid ${ui.colors.border}`,
            borderRadius: 8,
            padding: 16,
          }}
        >
          <Flex direction="column" gap={8}>
            {filtered.map((v) => (
              <EnvLine key={v.name} variable={v} />
            ))}
          </Flex>
        </Code>
      </ScrollArea>
    </Flex>
  );
};
