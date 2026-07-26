import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { jsonSchemaToZod, z } from "alepha";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { HttpClient } from "alepha/server";
import { useCallback, useMemo, useState } from "react";
import type { DevActionMetadata } from "../../../schemas/DevActionMetadata.ts";
import { useActionHistory } from "../../hooks/useActionHistory.ts";
import { useDevAuth } from "../../hooks/useDevAuth.ts";

const EMPTY_SCHEMA = z.object({});

export interface ActionTryItProps {
  action: DevActionMetadata;
}

interface TryItResponse {
  status?: number;
  data?: unknown;
  error?: string;
  ms: number;
}

/**
 * Execute an action against the running application.
 *
 * Forms are generated from the action's published JSON Schema via
 * `jsonSchemaToZod` — the documented inverse of the collector's
 * `z.toJSONSchema`. Before the collector published JSON Schema this conversion
 * silently produced an empty object and every form rendered zero fields.
 */
export const ActionTryIt = (props: ActionTryItProps) => {
  const action = props.action;
  const http = useInject(HttpClient);
  const auth = useDevAuth();
  const history = useActionHistory(`${action.method}:${action.fullPath}`);
  const [response, setResponse] = useState<TryItResponse | null>(null);
  const [sending, setSending] = useState(false);

  const key = `${action.method}:${action.fullPath}`;

  const toSchema = useCallback((jsonSchema: any) => {
    if (!jsonSchema) return null;
    try {
      const converted = jsonSchemaToZod(jsonSchema);
      return converted && z.schema.isObject(converted) ? converted : null;
    } catch {
      return null;
    }
  }, []);

  const paramsSchema = useMemo(() => toSchema(action.params), [key, toSchema]);
  const querySchema = useMemo(() => toSchema(action.query), [key, toSchema]);
  const bodySchema = useMemo(
    () =>
      action.method.toUpperCase() === "GET" ? null : toSchema(action.body),
    [key, toSchema],
  );

  const paramsForm = useForm(
    { schema: paramsSchema ?? EMPTY_SCHEMA, handler: () => {} },
    [paramsSchema],
  );
  const queryForm = useForm(
    { schema: querySchema ?? EMPTY_SCHEMA, handler: () => {} },
    [querySchema],
  );
  const bodyForm = useForm(
    { schema: bodySchema ?? EMPTY_SCHEMA, handler: () => {} },
    [bodySchema],
  );

  const buildUrl = useCallback((): string => {
    let url = action.fullPath;
    if (paramsSchema) {
      for (const [k, v] of Object.entries(paramsForm.currentValues)) {
        if (v !== undefined && v !== null && v !== "") {
          url = url.replace(`:${k}`, encodeURIComponent(String(v)));
        }
      }
    }
    if (querySchema) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(queryForm.currentValues)) {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    return url;
  }, [action, paramsSchema, querySchema, paramsForm, queryForm]);

  const send = useCallback(async () => {
    setSending(true);
    setResponse(null);
    const started = performance.now();
    try {
      const isGet = action.method.toUpperCase() === "GET";
      const res = await http.fetch(buildUrl(), {
        method: action.method,
        body:
          !isGet && bodySchema
            ? JSON.stringify(bodyForm.currentValues)
            : undefined,
        headers: {
          ...(isGet ? {} : { "Content-Type": "application/json" }),
          ...auth.toHeaders(),
        },
      });
      const ms = Math.round(performance.now() - started);
      setResponse({ status: res.status, data: res.data, ms });
      history.record({
        at: Date.now(),
        status: res.status,
        ms,
        params: paramsSchema ? paramsForm.currentValues : undefined,
        query: querySchema ? queryForm.currentValues : undefined,
        body: bodySchema ? bodyForm.currentValues : undefined,
      });
    } catch (e: any) {
      const ms = Math.round(performance.now() - started);
      setResponse({ error: e?.message ?? "Request failed", ms });
      history.record({
        at: Date.now(),
        ms,
        error: e?.message ?? "Request failed",
        params: paramsSchema ? paramsForm.currentValues : undefined,
        query: querySchema ? queryForm.currentValues : undefined,
        body: bodySchema ? bodyForm.currentValues : undefined,
      });
    } finally {
      setSending(false);
    }
  }, [
    action,
    http,
    buildUrl,
    bodySchema,
    bodyForm,
    paramsSchema,
    querySchema,
    paramsForm,
    queryForm,
    history,
    auth,
  ]);

  return (
    <div>
      {paramsSchema && (
        <>
          <div className="dt-section-label">Path parameters</div>
          <div className="dt-form" style={{ padding: "10px 14px" }}>
            <AutoForm form={paramsForm} noSubmit />
          </div>
        </>
      )}

      {querySchema && (
        <>
          <div className="dt-section-label">Query parameters</div>
          <div className="dt-form" style={{ padding: "10px 14px" }}>
            <AutoForm form={queryForm} noSubmit />
          </div>
        </>
      )}

      {bodySchema && (
        <>
          <div className="dt-section-label">Request body</div>
          <div className="dt-form" style={{ padding: "10px 14px" }}>
            <AutoForm form={bodyForm} noSubmit />
          </div>
        </>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
        }}
      >
        <button
          type="button"
          className="dt-btn"
          data-variant="primary"
          disabled={sending}
          onClick={send}
        >
          {sending ? "Sending…" : "Send request"}
        </button>
        {response && (
          <span className="dt-mono" style={{ fontSize: 11 }}>
            <span
              style={{
                color:
                  response.error || (response.status ?? 500) >= 400
                    ? "var(--dt-error)"
                    : "var(--dt-get)",
              }}
            >
              {response.error ? "failed" : response.status}
            </span>
            <span style={{ color: "var(--dt-fg-faint)" }}>
              {" "}
              · {response.ms}ms
            </span>
          </span>
        )}
      </div>

      {response && (
        <>
          <div className="dt-section-label">Response</div>
          {response.error ? (
            <div
              style={{
                padding: "10px 14px",
                fontSize: 11,
                color: "var(--dt-error)",
              }}
            >
              {response.error}
            </div>
          ) : (
            <pre className="dt-pre">
              {JSON.stringify(response.data, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
};
