import { z as zod } from "zod";

/**
 * Legacy-compatibility shims so typebox-era structural accessors keep working
 * on zod schemas (the "short path" for the migration — avoids rewriting
 * hundreds of schema-walking call-sites):
 *
 *   typebox            zod            alias added here
 *   ----------------   ------------   ----------------
 *   obj.properties     obj.shape      .properties -> .shape
 *   array.items        array.element  .items      -> .element
 *   union.anyOf        union.options  .anyOf      -> .options
 *
 * Both the runtime (prototype getters) and the type-level (`declare module`
 * interface merge) are provided, so `schema.properties` resolves and typechecks.
 *
 * Imported for side-effects by ZodProvider so it loads with the `z` core.
 */
declare module "zod" {
  interface ZodObject {
    /** typebox-compat alias for {@link ZodObject.shape}. */
    readonly properties: this["shape"];
  }
  interface ZodArray {
    /** typebox-compat alias for {@link ZodArray.element}. */
    readonly items: this["element"];
  }
  interface ZodUnion {
    /** typebox-compat alias for {@link ZodUnion.options}. */
    readonly anyOf: this["options"];
  }
  interface ZodTuple {
    /** typebox-compat alias for the tuple's element schemas. */
    readonly items: readonly import("zod").ZodType[];
  }
}

const alias = (
  ctor: { prototype: object } | undefined,
  name: string,
  target: string,
): void => {
  const proto = ctor?.prototype as Record<string, unknown> | undefined;
  if (!proto || Object.getOwnPropertyDescriptor(proto, name)) return;
  Object.defineProperty(proto, name, {
    configurable: true,
    get(this: Record<string, unknown>) {
      return this[target];
    },
  });
};

alias(zod.ZodObject, "properties", "shape");
alias(zod.ZodArray, "items", "element");
alias(zod.ZodUnion, "anyOf", "options");

// ZodTuple stores its element schemas at `_zod.def.items` (nested) — custom getter.
{
  const proto = (zod.ZodTuple as { prototype?: object } | undefined)
    ?.prototype as Record<string, unknown> | undefined;
  if (proto && !Object.getOwnPropertyDescriptor(proto, "items")) {
    Object.defineProperty(proto, "items", {
      configurable: true,
      get(this: { _zod?: { def?: { items?: unknown } } }) {
        return this?._zod?.def?.items ?? [];
      },
    });
  }
}
