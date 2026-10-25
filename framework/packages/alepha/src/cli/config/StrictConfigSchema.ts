import { type ZType } from "alepha";

/**
 * Derive strict config validation without changing the atoms used by code.
 */
export class StrictConfigSchema {
  public static from(schema: ZType): ZType {
    const source = schema as any;
    const definition = { ...source.def };
    if (definition.type === "object") {
      definition.shape = Object.fromEntries(
        Object.entries(source.shape).map(([key, value]) => [
          key,
          this.from(value as ZType),
        ]),
      );
    }
    for (const key of [
      "innerType",
      "element",
      "valueType",
      "in",
      "out",
      "rest",
    ]) {
      if (definition[key]?.safeParse)
        definition[key] = this.from(definition[key]);
    }
    for (const key of ["options", "items"]) {
      if (Array.isArray(definition[key]))
        definition[key] = definition[key].map((item: ZType) => this.from(item));
    }
    const result = source.clone(definition);
    return definition.type === "object" ? result.strict() : result;
  }
}
