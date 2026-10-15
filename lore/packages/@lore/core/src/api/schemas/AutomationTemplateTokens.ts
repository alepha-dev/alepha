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
  public whole(text: string): string | undefined {
    return /^{{\s*([A-Za-z0-9_]+)\s*}}$/.exec(text)?.[1];
  }
}
