import { useAlepha } from "alepha/react";
import { useEffect, useId, useMemo } from "react";

import { aiContextAtom } from "./aiContextAtom.ts";
import { type AiFillableForm, AiFormRegistry } from "./AiFormRegistry.ts";

/**
 * Declare what the current page shows the assistant: a short `page` name,
 * the `data` it displays, and optionally the `form` the assistant may fill
 * (never submit). Every turn sent while the page is mounted carries the
 * current route and the innermost declared context.
 *
 * @example
 * ```tsx
 * const InvoicePage = (props: InvoicePageProps) => {
 *   const form = useForm({ schema: invoiceSchema, handler: save });
 *   useAiContext({ page: "invoice", data: props.invoice, form });
 *   return <form {...form.props}>...</form>;
 * };
 * ```
 */
export const useAiContext = (options: UseAiContextOptions): void => {
  const alepha = useAlepha();
  const registry = useMemo(() => AiFormRegistry.of(alepha), [alepha]);
  const id = useId();
  const serialized = JSON.stringify([options.page, options.data]);

  useEffect(() => {
    const formId = options.form ? `${id}:form` : undefined;
    if (formId && options.form) {
      registry.register(formId, options.form);
    }
    const entry = {
      id,
      page: options.page,
      data: options.data,
      formId,
    };
    const current = alepha.store.get(aiContextAtom) ?? [];
    alepha.store.set(aiContextAtom, [
      ...current.filter((it) => it.id !== id),
      entry,
    ]);
    return () => {
      if (formId) {
        registry.unregister(formId);
      }
      alepha.store.set(
        aiContextAtom,
        (alepha.store.get(aiContextAtom) ?? []).filter((it) => it.id !== id),
      );
    };
    // `serialized` stands for page and data: a new object with the same
    // content must not re-register.
  }, [alepha, registry, id, serialized, options.form]);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface UseAiContextOptions {
  /**
   * A short name for the page, such as `invoice`.
   */
  page?: string;
  /**
   * What the page shows, as JSON. Capped at 8 KB serialized by the server.
   */
  data?: unknown;
  /**
   * The form `fillForm` may fill. Omit it and the assistant cannot fill
   * anything on this page.
   */
  form?: AiFillableForm;
}
