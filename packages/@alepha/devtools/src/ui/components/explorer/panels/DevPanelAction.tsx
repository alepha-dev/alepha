import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { jsonSchemaToTypeBox, t } from "alepha";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { HttpClient } from "alepha/server";
import { Braces, Play } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

const methodVariant = (
  method: string,
): "default" | "secondary" | "destructive" | "outline" => {
  switch (method.toUpperCase()) {
    case "DELETE":
      return "destructive";
    case "GET":
      return "secondary";
    default:
      return "default";
  }
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

const formatPermission = (perm: any): string =>
  typeof perm === "string" ? perm : (perm?.name ?? String(perm));

const getMiddlewareSummary = (
  name: string,
  opts: any,
): { label: string }[] | null => {
  if (!opts) return null;
  switch (name) {
    case "$rateLimit":
      if (opts.max) return [{ label: `max:${opts.max}` }];
      break;
    case "$circuit":
      if (opts.threshold) return [{ label: `threshold:${opts.threshold}` }];
      break;
    case "$throttle":
      if (opts.rate) return [{ label: `rate:${opts.rate}` }];
      break;
    case "$retry":
      if (opts.max) return [{ label: `max:${opts.max}` }];
      break;
    case "$cors":
      if (opts.origin) return [{ label: String(opts.origin) }];
      break;
    case "$lock":
      if (opts.key) return [{ label: `key:${opts.key}` }];
      break;
  }
  return null;
};

interface MiddlewareEntryProps {
  mw: any;
}

const MiddlewareEntry = (props: MiddlewareEntryProps) => {
  const mw = props.mw;
  const opts = mw.options;
  const hasSecureDetails =
    opts?.roles?.length ||
    opts?.permissions?.length ||
    opts?.issuers?.length ||
    opts?.optional;

  const summary =
    mw.name !== "$secure" ? getMiddlewareSummary(mw.name, opts) : null;

  const nameBadge = <Badge variant="secondary">{mw.name}</Badge>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {opts && !hasSecureDetails && !summary && mw.name !== "$secure" ? (
        <Tooltip>
          <TooltipTrigger render={nameBadge} />
          <TooltipContent className="max-w-md font-mono text-xs">
            <pre>{JSON.stringify(opts, null, 2)}</pre>
          </TooltipContent>
        </Tooltip>
      ) : (
        nameBadge
      )}
      {opts?.roles?.length > 0 &&
        opts.roles.map((role: string) => (
          <Badge key={role} variant="outline" className="text-xs">
            {role}
          </Badge>
        ))}
      {opts?.permissions?.length > 0 &&
        opts.permissions.map((perm: any) => (
          <Badge
            key={formatPermission(perm)}
            variant="outline"
            className="text-xs"
          >
            {formatPermission(perm)}
          </Badge>
        ))}
      {opts?.issuers?.length > 0 &&
        opts.issuers.map((issuer: string) => (
          <Badge key={issuer} variant="outline" className="text-xs">
            {issuer}
          </Badge>
        ))}
      {opts?.optional && (
        <Badge variant="outline" className="text-xs">
          optional
        </Badge>
      )}
      {summary?.map((item) => (
        <Badge key={item.label} variant="outline" className="text-xs">
          {item.label}
        </Badge>
      ))}
    </div>
  );
};

interface DevPanelActionProps {
  action: any;
}

export const DevPanelAction = (props: DevPanelActionProps) => {
  const action = props.action;
  const http = useInject(HttpClient);
  const [body, setBody] = useState("{}");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [timing, setTiming] = useState<number>(0);
  const [tab, setTab] = useState<string>("schema");

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

  const useTypeFormBody = !!bodySchema;
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const execute = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    const start = performance.now();
    try {
      let url = action.fullPath;
      if (paramsSchema) {
        const params = paramsForm.currentValues;
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null) {
            url = url.replace(`:${k}`, encodeURIComponent(String(v)));
          }
        }
      }

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

  const renderJsonCard = (label: string, data: any) => (
    <div>
      <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
        {label}
      </p>
      <Card className="p-3">
        <pre className="overflow-auto text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      </Card>
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Badge variant={methodVariant(action.method)}>{action.method}</Badge>
          <code className="bg-muted rounded px-2 py-0.5 text-sm">
            {action.fullPath}
          </code>
          {action.secure && <Badge variant="outline">Secure</Badge>}
        </div>
        {action.description && (
          <p className="text-muted-foreground text-sm">{action.description}</p>
        )}
      </div>

      {action.middlewares?.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
            Middleware
          </p>
          <div className="flex flex-col gap-2">
            {action.middlewares.map((mw: any) => (
              <MiddlewareEntry key={mw.name} mw={mw} />
            ))}
          </div>
        </div>
      )}

      <ToggleGroup
        variant="outline"
        size="sm"
        value={[tab]}
        onValueChange={(v) => {
          const next = v[0];
          if (next) setTab(next);
        }}
      >
        <ToggleGroupItem value="schema">
          <Braces className="size-3.5" /> Schema
        </ToggleGroupItem>
        <ToggleGroupItem value="tryit">
          <Play className="size-3.5" /> Try It
        </ToggleGroupItem>
      </ToggleGroup>

      {tab === "schema" && (
        <div className="flex flex-col gap-4">
          {action.body && renderJsonCard("Request Body", action.body)}
          {action.params && renderJsonCard("Path Parameters", action.params)}
          {action.query && renderJsonCard("Query Parameters", action.query)}
          {action.response && renderJsonCard("Response", action.response)}
          {!action.body &&
            !action.params &&
            !action.query &&
            !action.response && (
              <p className="text-muted-foreground text-sm">
                No schema defined for this action.
              </p>
            )}
        </div>
      )}

      {tab === "tryit" && (
        <div className="flex flex-col gap-4">
          {paramsSchema && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                Path Parameters
              </p>
              <AutoForm form={paramsForm} noSubmit />
            </div>
          )}
          {querySchema && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                Query Parameters
              </p>
              <AutoForm form={queryForm} noSubmit />
            </div>
          )}
          {action.method !== "GET" && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                Request Body
              </p>
              {bodySchema ? (
                <AutoForm form={bodyForm} noSubmit />
              ) : (
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                />
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={loading} onClick={execute}>
              <Play className="size-3.5" />
              {loading ? "Sending..." : "Send Request"}
            </Button>
            {timing > 0 && (
              <span className="text-muted-foreground text-xs">{timing}ms</span>
            )}
          </div>
          {response && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                Response
              </p>
              <Card className="p-3">
                {response.error ? (
                  <p className="text-destructive text-sm">{response.error}</p>
                ) : (
                  <>
                    <Badge
                      variant={
                        response.status < 400 ? "default" : "destructive"
                      }
                      className="mb-2"
                    >
                      {response.status}
                    </Badge>
                    <pre className="overflow-auto text-xs">
                      {JSON.stringify(response.data, null, 2)}
                    </pre>
                  </>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
