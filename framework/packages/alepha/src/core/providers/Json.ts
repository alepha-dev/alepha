/**
 * Mimics the JSON global object with stringify and parse methods.
 *
 * Used across the codebase via dependency injection.
 */
export class Json {
  stringify = JSON.stringify;
  parse = JSON.parse;
}
