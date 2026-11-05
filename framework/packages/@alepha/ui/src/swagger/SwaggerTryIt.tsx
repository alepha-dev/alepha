import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";

import { Segmented } from "../core/Segmented.tsx";
import type { OpenApiSpec, SwaggerEntry } from "./OpenApiSpec.ts";
import {
  type SwaggerBodyMode,
  type SwaggerRequest,
  SwaggerRequestBuilder,
} from "./SwaggerRequestBuilder.ts";
import {
  type SwaggerResponseResult,
  SwaggerResponseView,
} from "./SwaggerResponseView.tsx";
import { SwaggerTryItForm } from "./SwaggerTryItForm.tsx";

export interface SwaggerTryItProps {
  spec: OpenApiSpec;
  entry: SwaggerEntry;
  /**
   * Prefixed to the operation's path, empty for the page's own origin.
   */
  origin?: string;
  /**
   * Last word on the request before it is sent: where the explorer adds the
   * credentials it holds.
   */
  prepare?: (request: SwaggerRequest) => SwaggerRequest;
}

/**
 * Send a request to an operation and see what comes back.
 *
 * The form is built from the operation's schemas (`SwaggerRequestBuilder`):
 * a field per parameter, the body as fields or as raw JSON, a multipart body
 * as one field per part with a file input for each binary part. The response
 * is read as a stream, so a streamed body (server-sent events, a chunked
 * download) shows as it arrives.
 *
 * The request goes out with the platform `fetch` and the browser's own
 * credentials for the origin (cookies included), never through `HttpClient`:
 * this is a raw HTTP call to whatever the document describes. Mount it keyed
 * by operation, so a new operation starts with no stale response.
 */
export const SwaggerTryIt = (props: SwaggerTryItProps) => {
  const { tr } = useI18n();
  const [mode, setMode] = useState<SwaggerBodyMode>("form");
  const [result, setResult] = useState<SwaggerResponseResult | undefined>();

  const builder = useMemo(
    () => new SwaggerRequestBuilder(props.spec),
    [props.spec],
  );
  const model = useMemo(
    () => builder.build(props.entry, mode),
    [builder, props.entry, mode],
  );

  return (
    <section className="flex flex-col gap-3">
      {model.mediaType && model.formable && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {tr("swagger.tryIt.body", { default: "Body" })}
          </span>
          <Segmented
            size="sm"
            value={mode}
            onChange={(value) => setMode(value as SwaggerBodyMode)}
            options={[
              {
                value: "form",
                label: tr("swagger.tryIt.form", { default: "Form" }),
              },
              {
                value: "json",
                label: tr("swagger.tryIt.json", { default: "JSON" }),
              },
            ]}
          />
        </div>
      )}
      <SwaggerTryItForm
        key={`${props.entry.id}:${model.mode}`}
        builder={builder}
        model={model}
        entry={props.entry}
        origin={props.origin}
        prepare={props.prepare}
        onResult={setResult}
      />
      {result && <SwaggerResponseView result={result} />}
    </section>
  );
};
