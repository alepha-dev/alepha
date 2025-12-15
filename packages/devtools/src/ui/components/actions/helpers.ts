import type { DevActionMetadata } from "../../../api/schemas/DevActionMetadata.ts";

export const generateCurl = (
  action: DevActionMetadata,
  body?: string,
): string => {
  const parts = [`curl -X ${action.method.toUpperCase()}`];
  parts.push(`  '${window.location.origin}${action.fullPath}'`);

  if (action.body && body) {
    parts.push(
      `  -H 'Content-Type: ${action.bodyContentType || "application/json"}'`,
    );
    parts.push(`  -d '${body}'`);
  }

  return parts.join(" \\\n");
};
