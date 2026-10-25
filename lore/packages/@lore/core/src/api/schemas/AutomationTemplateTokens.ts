import { AlephaError } from "alepha";

/**
 * Lexical placeholder grammar, shared by catalogue checks and rendering.
 */
export class AutomationTemplateTokens {
  public names(text: string): string[] {
    const pattern = /{{\s*([A-Za-z0-9_]+)\s*}}/g;
    const names = [...text.matchAll(pattern)].map((match) => match[1]);
    if (
      text.replace(pattern, "").includes("{{") ||
      text.replace(pattern, "").includes("}}")
    )
      throw new AlephaError(
        "Invalid placeholder: use {{name}}, with no expressions or paths",
      );
    return names;
  }
  public inValue(value: unknown): string[] {
    if (typeof value === "string") return this.names(value);
    if (Array.isArray(value))
      return value.flatMap((item) => this.inValue(item));
    if (value && typeof value === "object")
      return Object.values(value).flatMap((item) => this.inValue(item));
    return [];
  }
  public replace(text: string, value: (name: string) => string): string {
    this.names(text);
    return text.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_match, name: string) =>
      value(name),
    );
  }
  public whole(text: string): string | undefined {
    return /^{{\s*([A-Za-z0-9_]+)\s*}}$/.exec(text)?.[1];
  }
}
