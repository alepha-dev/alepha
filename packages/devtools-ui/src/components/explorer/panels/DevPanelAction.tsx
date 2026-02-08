import { ActionButton, TypeForm, ui } from "@alepha/ui";
import { JsonViewer } from "@alepha/ui/json";
import {
  Badge,
  Card,
  Code,
  Group,
  JsonInput,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { IconPlayerPlay, IconSchema } from "@tabler/icons-react";
import { jsonSchemaToTypeBox, t } from "alepha";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { HttpClient } from "alepha/server";
import { useCallback, useMemo, useRef, useState } from "react";

const methodColors: Record<string, string> = {
  GET: "teal",
  POST: "blue",
  PUT: "orange",
  PATCH: "yellow",
  DELETE: "red",
};

const EMPTY_SCHEMA = t.object({});

const toTypeBoxObject = (jsonSchema: any): any => {
  if (!jsonSchema) return null;
  try {
    const converted = jsonSchemaToTypeBox(jsonSchema);
    if (converted?.properties) return converted;
  } catch {
    // Schema conversion failed
  }
  return null;
};

export const DevPanelAction = ({ action }: { action: any }) => {
  const http = useInject(HttpClient);
  const [body, setBody] = useState("{}");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [timing, setTiming] = useState<number>(0);

  const actionKey = `${action.method}:${action.fullPath}`;

  const bodySchema = useMemo(
    () => (action.method !== "GET" ? toTypeBoxObject(action.body) : null),
    [actionKey],
  );
  const querySchema = useMemo(() => toTypeBoxObject(action.query), [actionKey]);
  const paramsSchema = useMemo(
    () => toTypeBoxObject(action.params),
    [actionKey],
  );

  const bodyForm = useForm(
    { schema: bodySchema ?? EMPTY_SCHEMA, handler: () => {} },
    [bodySchema],
  );
  const queryForm = useForm(
    { schema: querySchema ?? EMPTY_SCHEMA, handler: () => {} },
    [querySchema],
  );
  const paramsForm = useForm(
    { schema: paramsSchema ?? EMPTY_SCHEMA, handler: () => {} },
    [paramsSchema],
  );

  // Track whether we're using TypeForm or JsonInput for the body
  const useTypeFormBody = !!bodySchema;
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const execute = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    const start = performance.now();
    try {
      // Build URL with path param substitution
      let url = action.fullPath;
      if (paramsSchema) {
        const params = paramsForm.currentValues;
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null) {
            url = url.replace(`:${k}`, encodeURIComponent(String(v)));
          }
        }
      }

      // Append query params
      if (querySchema) {
        const qp = queryForm.currentValues;
        const searchParams = new URLSearchParams();
        for (const [k, v] of Object.entries(qp)) {
          if (v !== undefined && v !== null && v !== "") {
            searchParams.set(k, String(v));
          }
        }
        const qs = searchParams.toString();
        if (qs) url += `?${qs}`;
      }

      // Get body
      let parsedBody: any;
      if (action.method !== "GET") {
        if (useTypeFormBody) {
          parsedBody = bodyForm.currentValues;
        } else {
          try {
            parsedBody = JSON.parse(bodyRef.current);
          } catch {
            parsedBody = undefined;
          }
        }
      }

      const res = await http.fetch(url, {
        method: action.method,
        body: action.method !== "GET" ? JSON.stringify(parsedBody) : undefined,
        headers:
          action.method !== "GET"
            ? { "Content-Type": "application/json" }
            : undefined,
      });
      setTiming(Math.round(performance.now() - start));
      setResponse({ status: res.status, data: res.data });
    } catch (error: any) {
      setTiming(Math.round(performance.now() - start));
      setResponse({ error: error.message ?? "Request failed" });
    } finally {
      setLoading(false);
    }
  }, [
    http,
    action,
    useTypeFormBody,
    bodyForm,
    queryForm,
    paramsForm,
    bodySchema,
    querySchema,
    paramsSchema,
  ]);

  return (
    <Stack gap="md">
      <div>
        <Group gap="sm" mb="xs">
          <Badge
            size="lg"
            variant="light"
            color={methodColors[action.method] ?? "gray"}
          >
            {action.method}
          </Badge>
          <Code fz="sm">{action.fullPath}</Code>
          {action.secure && (
            <Badge size="xs" variant="outline" color="yellow">
              Secure
            </Badge>
          )}
        </Group>
        {action.description && (
          <Text fz="sm" c="dimmed">
            {action.description}
          </Text>
        )}
      </div>

      <Tabs defaultValue="schema">
        <Tabs.List>
          <Tabs.Tab value="schema" leftSection={<IconSchema size={14} />}>
            Schema
          </Tabs.Tab>
          <Tabs.Tab value="tryit" leftSection={<IconPlayerPlay size={14} />}>
            Try It
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="schema" pt="md">
          <Stack gap="md">
            {action.body && (
              <div>
                <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
                  Request Body
                </Text>
                <Card
                  padding="sm"
                  style={{
                    background: ui.colors.surface,
                    border: `1px solid ${ui.colors.border}`,
                  }}
                >
                  <JsonViewer
                    data={action.body}
                    defaultExpandedDepth={2}
                    size="xs"
                  />
                </Card>
              </div>
            )}
            {action.params && (
              <div>
                <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
                  Path Parameters
                </Text>
                <Card
                  padding="sm"
                  style={{
                    background: ui.colors.surface,
                    border: `1px solid ${ui.colors.border}`,
                  }}
                >
                  <JsonViewer
                    data={action.params}
                    defaultExpandedDepth={2}
                    size="xs"
                  />
                </Card>
              </div>
            )}
            {action.query && (
              <div>
                <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
                  Query Parameters
                </Text>
                <Card
                  padding="sm"
                  style={{
                    background: ui.colors.surface,
                    border: `1px solid ${ui.colors.border}`,
                  }}
                >
                  <JsonViewer
                    data={action.query}
                    defaultExpandedDepth={2}
                    size="xs"
                  />
                </Card>
              </div>
            )}
            {action.response && (
              <div>
                <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
                  Response
                </Text>
                <Card
                  padding="sm"
                  style={{
                    background: ui.colors.surface,
                    border: `1px solid ${ui.colors.border}`,
                  }}
                >
                  <JsonViewer
                    data={action.response}
                    defaultExpandedDepth={2}
                    size="xs"
                  />
                </Card>
              </div>
            )}
            {!action.body &&
              !action.params &&
              !action.query &&
              !action.response && (
                <Text c="dimmed" fz="sm">
                  No schema defined for this action.
                </Text>
              )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="tryit" pt="md">
          <Stack gap="md">
            {paramsSchema && (
              <div>
                <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
                  Path Parameters
                </Text>
                <TypeForm
                  form={paramsForm}
                  skipSubmitButton
                  skipFormElement
                  columns={1}
                />
              </div>
            )}
            {querySchema && (
              <div>
                <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
                  Query Parameters
                </Text>
                <TypeForm
                  form={queryForm}
                  skipSubmitButton
                  skipFormElement
                  columns={1}
                />
              </div>
            )}
            {action.method !== "GET" && (
              <div>
                <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
                  Request Body
                </Text>
                {bodySchema ? (
                  <TypeForm
                    form={bodyForm}
                    skipSubmitButton
                    skipFormElement
                    columns={1}
                  />
                ) : (
                  <JsonInput
                    value={body}
                    onChange={setBody}
                    formatOnBlur
                    autosize
                    minRows={4}
                    maxRows={12}
                    styles={{
                      input: { fontFamily: "monospace", fontSize: 12 },
                    }}
                  />
                )}
              </div>
            )}
            <Group>
              <ActionButton
                size="xs"
                loading={loading}
                onClick={execute}
                color={methodColors[action.method] ?? "blue"}
                icon={<IconPlayerPlay size={14} />}
              >
                Send Request
              </ActionButton>
              {timing > 0 && (
                <Text fz="xs" c="dimmed">
                  {timing}ms
                </Text>
              )}
            </Group>
            {response && (
              <div>
                <Text fz="xs" c="dimmed" mb="xs" tt="uppercase" fw={600}>
                  Response
                </Text>
                <Card
                  padding="sm"
                  style={{
                    background: ui.colors.surface,
                    border: `1px solid ${ui.colors.border}`,
                  }}
                >
                  {response.error ? (
                    <Text c="red" fz="sm">
                      {response.error}
                    </Text>
                  ) : (
                    <>
                      <Badge
                        size="xs"
                        mb="xs"
                        color={response.status < 400 ? "teal" : "red"}
                      >
                        {response.status}
                      </Badge>
                      <JsonViewer
                        data={response.data}
                        defaultExpandedDepth={3}
                        size="xs"
                      />
                    </>
                  )}
                </Card>
              </div>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};
