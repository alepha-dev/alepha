/**
 * What an attachment can be shown as inside the preview dialog.
 *
 * Driven by MIME type first and extension second, because the browser sets
 * `type` from the OS and gets it wrong or blank often enough that the name
 * has to be able to answer on its own: a `.md` picked on Linux frequently
 * arrives as `text/plain`, and an unknown extension as `""`.
 */
export type AttachmentPreview =
  | { kind: "image" }
  | { kind: "markdown" }
  | { kind: "text"; language: string }
  | { kind: "none" };

/**
 * Extension to highlight.js language. Only languages that library actually
 * knows: an unknown hint makes it fall back to plaintext anyway, so listing
 * `csv` here would promise colour it cannot deliver.
 */
const LANGUAGES: Record<string, string> = {
  json: "json",
  html: "xml",
  htm: "xml",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  css: "css",
  sh: "bash",
  bash: "bash",
  sql: "sql",
  py: "python",
  go: "go",
  rs: "rust",
  toml: "ini",
  ini: "ini",
};

/** Extensions shown as text with no language hint. */
const PLAIN = new Set(["txt", "csv", "tsv", "log", "env", "diff", "patch"]);

export const attachmentPreview = (
  name: string,
  mimeType: string,
): AttachmentPreview => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (mimeType.startsWith("image/")) {
    return { kind: "image" };
  }
  if (ext === "md" || ext === "markdown") {
    return { kind: "markdown" };
  }
  if (LANGUAGES[ext]) {
    return { kind: "text", language: LANGUAGES[ext] };
  }
  if (PLAIN.has(ext)) {
    return { kind: "text", language: "" };
  }
  // `text/*` the extension did not name: still readable, just unhinted.
  if (mimeType.startsWith("text/")) {
    return { kind: "text", language: "" };
  }
  return { kind: "none" };
};

/**
 * Ceiling on what the dialog will fetch and render.
 *
 * A preview is a glance, and a multi-megabyte log pulled into a string and
 * handed to a syntax highlighter locks the tab. Past this the dialog says so
 * and offers the file instead.
 */
export const PREVIEW_MAX_BYTES = 512 * 1024;
