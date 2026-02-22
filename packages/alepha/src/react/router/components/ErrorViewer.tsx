import type { Alepha } from "alepha";
import type { CSSProperties } from "react";

interface ErrorViewerProps {
  error: Error;
  alepha: Alepha;
}

const mono =
  'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const ErrorViewer = ({ error, alepha }: ErrorViewerProps) => {
  if (alepha.isProduction()) {
    return <div style={s.root}>Something went wrong.</div>;
  }

  return (
    <div style={s.root}>
      <ErrorBlock error={error} />
    </div>
  );
};

export default ErrorViewer;

function ErrorBlock({ error, depth = 0 }: { error: Error; depth?: number }) {
  return (
    <>
      {depth > 0 && <div style={s.caused}>Caused by:</div>}
      <div style={s.name}>
        {error.name}: {error.message}
      </div>
      {error.stack && <pre style={s.stack}>{cleanStack(error.stack)}</pre>}
      {error.cause instanceof Error && (
        <ErrorBlock error={error.cause} depth={depth + 1} />
      )}
    </>
  );
}

function cleanStack(stack: string): string {
  return stack
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .join("\n");
}

const s: Record<string, CSSProperties> = {
  root: {
    padding: "24px",
    fontFamily: mono,
    fontSize: "13px",
    color: "#333",
    backgroundColor: "#fff",
  },
  name: {
    color: "#dc2626",
    fontSize: "14px",
    fontWeight: 600,
    marginBottom: "8px",
    wordBreak: "break-word",
  },
  stack: {
    margin: "0 0 20px",
    padding: "12px",
    backgroundColor: "#f5f5f5",
    borderRadius: "4px",
    border: "1px solid #e0e0e0",
    fontSize: "12px",
    lineHeight: 1.6,
    color: "#666",
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  caused: {
    fontSize: "11px",
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: "1px",
    marginBottom: "6px",
    paddingTop: "4px",
    borderTop: "1px solid #e0e0e0",
  },
};
