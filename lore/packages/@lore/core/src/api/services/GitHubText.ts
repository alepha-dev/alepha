/**
 * Text that came from GitHub, as data (epic #E177): a string, capped, or
 * nothing. Titles, bodies, branch names, logins and check names are all
 * untrusted, and every reader goes through this before keeping one.
 */
export class GitHubText {
  text(value: unknown, max: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.slice(0, max);
    return trimmed.length > 0 ? trimmed : undefined;
  }

  integer(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : undefined;
  }

  object(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
