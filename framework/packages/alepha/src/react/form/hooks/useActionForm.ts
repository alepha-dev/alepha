import type { Infer, SchemaOutput, ZObject } from "alepha";
import { ActionErrorPolicy } from "alepha/react";
import {
  type ActionPrimitive,
  type ClientRequestEntryContainer,
  type ClientRequestOptions,
  type ClientRequestResponse,
  type RequestConfigSchema,
  ValidationError,
} from "alepha/server";
import type { VirtualAction } from "alepha/server/links";

import type { FormCtrlOptions, FormModel } from "../services/FormModel.ts";
import { useForm } from "./useForm.ts";

/**
 * A form that posts one action: its values are the action's `body`.
 *
 * `action` is a client's (`useClient()`) or a local `$action`. The schema is
 * the action's own body schema, imported from the shared
 * `schemas/` file it is declared in (in the browser an action carries no
 * runtime schema). The type requires it to be that schema: one that drifts
 * from the action's body, or an action with no body, is a compile error.
 *
 * A refusal from the server for the `body` (a `ValidationError` with
 * `part: "body"`, from request validation or thrown by the handler) lands
 * under every field it names, and is not toasted when every one of them
 * landed. A refusal of the `params`, `query` or `headers` is not the user's
 * input: it stays a form-level error, like any other failure.
 *
 * ```tsx
 * const form = useActionForm(api.createQuest, {
 *   schema: createQuestBodySchema,
 *   params: { projectId },
 *   onSuccess: (quest) => router.push("quest", { params: { id: quest.id } }),
 * });
 *
 * return <AutoForm form={form} />;
 * ```
 *
 * Everything else is `useForm`'s: the same `FormModel`, events, submit
 * state, `validate` modes and `AutoForm` support. `deps` rebuilds the model,
 * as it does there.
 */
export const useActionForm = <C extends RequestConfigSchema, T extends ZObject>(
  action: VirtualAction<C> | ActionPrimitive<C, any>,
  options: UseActionFormOptions<C, T>,
  deps: any[] = [],
): FormModel<T> => {
  const form: FormModel<T> = useForm<T>(
    {
      ...options,
      schema: options.schema as T,
      handler: async (values) => {
        try {
          // An `$action` is callable like a client's action; its type only
          // does not say so.
          const call = action as VirtualAction<C>;
          const response = await call(
            {
              ...(options.params !== undefined && { params: options.params }),
              ...(options.query !== undefined && { query: options.query }),
              ...(options.headers !== undefined && {
                headers: options.headers,
              }),
              body: values,
            } as never,
            options.request,
          );
          await options.onSuccess?.(response, values);
        } catch (error) {
          if (
            error instanceof ValidationError &&
            error.data.part === "body" &&
            error.data.issues?.length &&
            form.setErrors(error.data.issues)
          ) {
            // Every issue is under its field: nothing left to toast.
            ActionErrorPolicy.markShownInPlace(error);
          }
          throw error;
        }
      },
    },
    deps,
  );
  return form;
};

/**
 * `T` when its values are exactly the body of `C`, an explanation otherwise:
 * a schema that drifts from the action is a type error on `schema`.
 */
export type ActionBodySchema<
  C extends RequestConfigSchema,
  T extends ZObject,
> = [C["body"]] extends [undefined]
  ? "useActionForm: this action has no body"
  : [Infer<T>] extends [SchemaOutput<C["body"], never>]
    ? [SchemaOutput<C["body"], never>] extends [Infer<T>]
      ? T
      : "useActionForm: the schema does not match the action's body"
    : "useActionForm: the schema does not match the action's body";

export interface UseActionFormOptions<
  C extends RequestConfigSchema,
  T extends ZObject,
> extends Omit<FormCtrlOptions<T>, "schema" | "handler"> {
  /**
   * The action's body schema, imported from its shared `schemas/` file.
   */
  schema: ActionBodySchema<C, T> & T;

  /**
   * The action's path parameters.
   */
  params?: ClientRequestEntryContainer<C>["params"];

  /**
   * The action's query.
   */
  query?: ClientRequestEntryContainer<C>["query"];

  /**
   * The action's headers.
   */
  headers?: ClientRequestEntryContainer<C>["headers"];

  /**
   * Options for the call itself (`request`, `timeout`, ...).
   */
  request?: ClientRequestOptions;

  /**
   * Called with the action's response once it succeeded, and the values
   * that were sent.
   */
  onSuccess?: (response: ClientRequestResponse<C>, values: Infer<T>) => unknown;
}
