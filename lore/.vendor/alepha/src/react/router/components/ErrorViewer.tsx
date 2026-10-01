import type { Alepha } from "alepha";
import { type CSSProperties, useState } from "react";

import { useRouterState } from "../hooks/useRouterState.ts";

export interface ErrorViewerProps {
  error: Error;
  alepha: Alepha;
  onRetry?: () => void;
}

const mono =
  'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const ErrorViewer = (props: ErrorViewerProps) => {
  if (props.alepha.isProduction()) {
    return <ProdErrorPage error={props.error} />;
  }

  return <DevErrorPage {...props} />;
};

export default ErrorViewer;

// ----- Dev Error Page -----

const DevErrorPage = (props: ErrorViewerProps) => {
  const [copied, setCopied] = useState(false);
  const state = useRouterState();
  const pathname = state.url.pathname;

  const handleCopy = () => {
    const text = buildErrorText(props.error);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const status = getHttpStatus(props.error);

  return (
    <div style={dev.overlay}>
      <div style={dev.card}>
        <div style={dev.header}>
          <div style={dev.headerLeft}>
            <div style={dev.icon}>!</div>
            <div style={dev.title}>{props.error.name || "Error"}</div>
          </div>
          <div style={dev.headerRight}>
            {props.onRetry && (
              <button
                type="button"
                style={dev.retryBtn}
                onClick={props.onRetry}
              >
                Retry
              </button>
            )}
            <button type="button" style={dev.copyBtn} onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <ErrorBlock error={props.error} />

        <div style={dev.meta}>
          {pathname && <span style={dev.metaItem}>{pathname}</span>}
          {status && <span style={dev.statusBadge}>{status}</span>}
        </div>
      </div>
    </div>
  );
};

// ----- Error Block (recursive) -----

const ErrorBlock = (props: { error: Error; depth?: number }) => {
  const { error, depth = 0 } = props;

  return (
    <>
      {depth > 0 && <div style={dev.causedBy}>Caused by:</div>}
      <pre style={dev.messageBlock}>
        {error.name}: {error.message}
      </pre>
      {error.stack && (
        <>
          <div style={dev.stackLabel}>STACK TRACE</div>
          <pre style={dev.stackBlock}>{cleanStack(error.stack)}</pre>
        </>
      )}
      {error.cause instanceof Error && (
        <ErrorBlock error={error.cause} depth={depth + 1} />
      )}
    </>
  );
};

// ----- Prod Error Page -----

interface ProdErrorPageProps {
  error: Error;
}

const ProdErrorPage = (props: ProdErrorPageProps) => {
  const requestId = (props.error as any).requestId;
  const status = getHttpStatus(props.error);

  const handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  // An auth failure is not a malfunction — give it its own message instead
  // of the generic "something went wrong" (which implies a 500).
  const { heading, subtitle } =
    status === 401
      ? {
          heading: "Sign in required",
          subtitle: "Please sign in to view this page.",
        }
      : status === 403
        ? {
            heading: "Access denied",
            subtitle: "You do not have permission to view this page.",
          }
        : {
            heading: "Something went wrong",
            subtitle: "We're having trouble processing your request.",
          };

  // Reloading does not fix an auth failure — only offer it for real errors.
  const canReload = status !== 401 && status !== 403;

  return (
    <div style={prod.page}>
      <div style={prod.card}>
        <div style={prod.heading}>{heading}</div>
        <div style={prod.subtitle}>{subtitle}</div>
        {requestId && <div style={prod.refText}>Reference: {requestId}</div>}
        <div style={prod.actions}>
          {canReload && (
            <button type="button" style={prod.reloadBtn} onClick={handleReload}>
              Reload page
            </button>
          )}
          <a href="/" style={prod.homeLink}>
            Go home
          </a>
        </div>
      </div>
    </div>
  );
};

// ----- Helpers -----

function cleanStack(stack: string): string {
  return stack
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .join("\n");
}

function buildErrorText(error: Error): string {
  const parts: string[] = [];

  const append = (err: Error, depth: number) => {
    if (depth > 0) {
      parts.push(`\nCaused by:`);
    }
    parts.push(`${err.name}: ${err.message}`);
    if (err.stack) {
      parts.push(cleanStack(err.stack));
    }
    if (err.cause instanceof Error) {
      append(err.cause, depth + 1);
    }
  };

  append(error, 0);
  return parts.join("\n");
}

function getHttpStatus(error: Error): number | undefined {
  if ("status" in error && typeof (error as any).status === "number") {
    return (error as any).status;
  }
  return undefined;
}

// ----- Dev Styles -----

const dev: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 2147483647,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    backdropFilter: "blur(4px)",
    fontFamily: mono,
    fontSize: "13px",
    color: "#e5e7eb",
    boxSizing: "border-box",
    overflow: "auto",
  },
  card: {
    width: "100%",
    maxWidth: "900px",
    maxHeight: "90vh",
    overflow: "auto",
    padding: "24px",
    backgroundColor: "#111",
    borderLeft: "4px solid #ef4444",
    borderRadius: "8px",
    boxShadow: "0 25px 50px rgba(0, 0, 0, 0.5)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "20px",
    flexWrap: "wrap",
    gap: "12px",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0,
  },
  headerRight: {
    display: "flex",
    gap: "8px",
    flexShrink: 0,
  },
  icon: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    backgroundColor: "#ef4444",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: "16px",
    flexShrink: 0,
  },
  title: {
    color: "#f87171",
    fontSize: "18px",
    fontWeight: 700,
  },
  retryBtn: {
    padding: "6px 16px",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontFamily: mono,
    fontSize: "12px",
    fontWeight: 600,
  },
  copyBtn: {
    padding: "6px 16px",
    backgroundColor: "transparent",
    color: "#9ca3af",
    border: "1px solid #374151",
    borderRadius: "6px",
    cursor: "pointer",
    fontFamily: mono,
    fontSize: "12px",
    fontWeight: 600,
  },
  messageBlock: {
    margin: "0 0 12px",
    padding: "12px",
    backgroundColor: "#1f2937",
    borderRadius: "6px",
    color: "#f9fafb",
    fontSize: "13px",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "auto",
  },
  stackLabel: {
    fontSize: "10px",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    marginBottom: "6px",
    fontWeight: 600,
  },
  stackBlock: {
    margin: "0 0 20px",
    padding: "12px",
    backgroundColor: "#0f172a",
    borderRadius: "6px",
    color: "#94a3b8",
    fontSize: "12px",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    overflow: "auto",
  },
  causedBy: {
    fontSize: "10px",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    marginBottom: "8px",
    paddingTop: "12px",
    borderTop: "1px solid #374151",
    fontWeight: 600,
  },
  meta: {
    display: "flex",
    gap: "16px",
    alignItems: "center",
    paddingTop: "12px",
    borderTop: "1px solid #1f2937",
    flexWrap: "wrap",
  },
  metaItem: {
    fontSize: "11px",
    color: "#6b7280",
  },
  statusBadge: {
    fontSize: "11px",
    color: "#fbbf24",
    backgroundColor: "#422006",
    padding: "2px 8px",
    borderRadius: "4px",
    fontWeight: 600,
  },
};

// ----- Prod Styles -----

const prod: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: "24px",
  },
  card: {
    textAlign: "center",
    maxWidth: "440px",
  },
  heading: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#f1f5f9",
    marginBottom: "12px",
  },
  subtitle: {
    fontSize: "16px",
    color: "#94a3b8",
    marginBottom: "24px",
    lineHeight: 1.5,
  },
  refText: {
    fontSize: "13px",
    color: "#64748b",
    marginBottom: "24px",
    fontFamily: mono,
  },
  actions: {
    display: "flex",
    gap: "12px",
    justifyContent: "center",
    alignItems: "center",
  },
  reloadBtn: {
    padding: "10px 24px",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },
  homeLink: {
    padding: "10px 24px",
    color: "#94a3b8",
    textDecoration: "none",
    fontSize: "14px",
  },
};
