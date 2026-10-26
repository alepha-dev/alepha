import type { Alepha } from "alepha";

/**
 * The forms pages offered to the assistant with `useAiContext({ form })`,
 * by id. Only these can be filled by the `fillForm` client tool: an
 * assistant able to fill any open form (a sign-in, a payment) is not wanted.
 *
 * One per container, kept in its store rather than injected: `@alepha/ui`
 * has no module to register a service with, and a hook cannot add one to a
 * started container. Not an `$atom`, so never serialized: a form is a live
 * object, not state.
 */
export class AiFormRegistry {
  public static readonly key = "alepha.ui.ai.forms";

  /**
   * The registry of `alepha`, created on first use.
   */
  public static of(alepha: Alepha): AiFormRegistry {
    const store = alepha.store as unknown as {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
    };
    let registry = store.get(AiFormRegistry.key) as AiFormRegistry | undefined;
    if (!registry) {
      registry = new AiFormRegistry();
      store.set(AiFormRegistry.key, registry);
    }
    return registry;
  }

  protected readonly forms = new Map<string, AiFillableForm>();

  public register(id: string, form: AiFillableForm): void {
    this.forms.set(id, form);
  }

  public unregister(id: string): void {
    this.forms.delete(id);
  }

  public get(id: string): AiFillableForm | undefined {
    return this.forms.get(id);
  }

  /**
   * Set each value on the field of the same name, and never submit. A key
   * the form has no field for is reported, not created.
   */
  public fill(
    form: AiFillableForm,
    values: Record<string, unknown>,
  ): { filled: string[]; ignored: string[] } {
    const filled: string[] = [];
    const ignored: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      const field = form.input[key] as
        | { set?: (v: unknown) => void }
        | undefined;
      if (typeof field?.set === "function") {
        field.set(value);
        filled.push(key);
      } else {
        ignored.push(key);
      }
    }
    return { filled, ignored };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The slice of a `useForm()` model the registry needs: its fields.
 */
export interface AiFillableForm {
  input: Record<string, unknown>;
}
