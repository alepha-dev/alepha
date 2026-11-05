import { useI18n } from "alepha/react/i18n";
import { ChevronRight } from "lucide-react";

import { Badge, type BadgeTone } from "../core/Badge.tsx";
import { Spinner } from "../core/Spinner.tsx";

/**
 * What came back from a "try it" request, as it arrives.
 */
export interface SwaggerResponseResult {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  /**
   * The body as text so far. A streamed response grows while `done` is false.
   */
  body: string;
  contentType?: string;
  durationMs: number;
  done: boolean;
}

export interface SwaggerResponseViewProps {
  result: SwaggerResponseResult;
}

/**
 * The response of a sent request: status, time, size and headers, then the
 * body, pretty-printed when it is JSON and left as text otherwise. A streamed
 * body shows a spinner until the stream ends.
 */
export const SwaggerResponseView = (props: SwaggerResponseViewProps) => {
  const { tr } = useI18n();
  const result = props.result;
  const pretty = swaggerPrettyBody(result.body, result.contentType);
  const bytes = new TextEncoder().encode(result.body).length;

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border p-3"
      aria-label={tr("swagger.response", { default: "Response" })}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge
          variant="tint"
          tone={swaggerResponseTone(result.status)}
          className="font-mono"
        >
          {result.status}
        </Badge>
        <span>{result.statusText}</span>
        <span className="text-muted-foreground ml-auto font-mono text-xs">
          {result.durationMs} ms · {bytes} B
        </span>
        {!result.done && <Spinner className="size-3.5" />}
      </div>

      <details className="group/headers">
        <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 text-xs [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open/headers:rotate-90" />
          {tr("swagger.response.headers", { default: "Headers" })} (
          {result.headers.length})
        </summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-5 font-mono text-xs">
          {result.headers.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </details>

      {result.body ? (
        <pre className="bg-muted/40 max-h-[60vh] overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
          {pretty}
        </pre>
      ) : (
        <p className="text-muted-foreground text-xs">
          {result.done
            ? tr("swagger.response.empty", { default: "No body." })
            : tr("swagger.response.waiting", {
                default: "Waiting for data...",
              })}
        </p>
      )}
    </section>
  );
};

const swaggerPrettyBody = (body: string, contentType?: string): string => {
  if (!contentType?.includes("json") || !body) {
    return body;
  }
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
};

const swaggerResponseTone = (status: number): BadgeTone => {
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "info";
  if (status >= 400 && status < 500) return "warning";
  return "danger";
};
