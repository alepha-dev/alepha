/**
 * Mimics the JSON global object with stringify and parse methods.
 *
 * Used across the codebase via dependency injection.
 */
export class Json {
  public stringify(
    value: any,
    replacer?: (this: any, key: string, value: any) => any,
    space?: string | number,
  ): string {
    return JSON.stringify(value, replacer, space);
  }

  public parse(
    text: string,
    reviver?: (this: any, key: string, value: any) => any,
  ) {
    return JSON.parse(text, reviver);
  }
}
