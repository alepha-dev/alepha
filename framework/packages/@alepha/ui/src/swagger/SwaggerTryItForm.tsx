import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useRef } from "react";

import { AutoForm } from "../form/AutoForm.tsx";
import type { SwaggerEntry } from "./OpenApiSpec.ts";
import type {
  SwaggerRequest,
  SwaggerRequestBuilder,
  SwaggerRequestModel,
} from "./SwaggerRequestBuilder.ts";
import type { SwaggerResponseResult } from "./SwaggerResponseView.tsx";

export interface SwaggerTryItFormProps {
  builder: SwaggerRequestBuilder;
  model: SwaggerRequestModel;
  entry: SwaggerEntry;
  origin?: string;
  prepare?: (request: SwaggerRequest) => SwaggerRequest;
  /**
   * Called with each state of the response as it arrives, and with
   * `undefined` when a new send starts, so the previous response never reads
   * as the answer to a request that failed before any headers.
   */
  onResult: (result: SwaggerResponseResult | undefined) => void;
}

/**
 * The request form of one operation in one body mode, and the send.
 *
 * Its own component because `useForm` anchors its schema at mount: the
 * parent keys it by operation and mode, so switching either builds a fresh
 * form instead of validating against the previous schema.
 */
export const SwaggerTryItForm = (props: SwaggerTryItFormProps) => {
  const { tr } = useI18n();
  const dateTime = useInject(DateTimeProvider);
  const abort = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => abort.current?.abort(), []);

  const form = useForm(
    {
      schema: props.model.schema,
      initialValues: props.model.initialValues,
      handler: async (values) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        props.onResult(undefined);

        let request = props.builder.request(
          props.entry,
          props.model,
          values as Record<string, unknown>,
          props.origin,
        );
        if (props.prepare) {
          request = props.prepare(request);
        }

        const started = dateTime.nowMillis();
        try {
          const res = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            credentials: "same-origin",
            signal: controller.signal,
          });

          await props.builder.read(
            res,
            () => dateTime.nowMillis() - started,
            props.onResult,
          );
        } catch (error) {
          // Aborted by the form itself (unmounted, or a newer send): nothing
          // for the viewer to hear about.
          if (controller.signal.aborted) {
            return;
          }
          throw error;
        }
      },
    },
    [],
  );

  return (
    <AutoForm
      form={form}
      fields={props.model.fields as never}
      card
      title={tr("swagger.tryIt.title", { default: "Try it" })}
      submitLabel={tr("swagger.tryIt.send", { default: "Send" })}
      skipReset
    />
  );
};
