import type { Alepha } from "alepha";
import { useState } from "react";

interface ErrorViewerProps {
  error: Error;
  alepha: Alepha;
}

// TODO: design this better

const ErrorViewer = ({ error, alepha }: ErrorViewerProps) => {
  const [expanded, setExpanded] = useState(false);
  const isProduction = alepha.isProduction();
  // const status = isHttpError(error) ? error.status : 500;

  if (isProduction) {
    return <ErrorViewerProduction />;
  }

  const stackLines = error.stack?.split("\n") ?? [];
  const previewLines = stackLines.slice(0, 5);
  const hiddenLineCount = stackLines.length - previewLines.length;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch((err) => {
      console.error("Clipboard error:", err);
    });
  };

  const styles = {
    container: {
      padding: "24px",
      backgroundColor: "#FEF2F2",
      color: "#7F1D1D",
      border: "1px solid #FECACA",
      borderRadius: "16px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.05)",
      fontFamily: "monospace",
      maxWidth: "768px",
      margin: "40px auto",
    },
    heading: {
      fontSize: "20px",
      fontWeight: "bold",
      marginBottom: "10px",
    },
    name: {
      fontSize: "16px",
      fontWeight: 600,
    },
    message: {
      fontSize: "14px",
      marginBottom: "16px",
    },
    sectionHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: "12px",
      marginBottom: "4px",
      color: "#991B1B",
    },
    copyButton: {
      fontSize: "12px",
      color: "#DC2626",
      background: "none",
      border: "none",
      cursor: "pointer",
      textDecoration: "underline",
    },
    stackContainer: {
      backgroundColor: "#FEE2E2",
      padding: "12px",
      borderRadius: "8px",
      fontSize: "13px",
      lineHeight: "1.4",
      overflowX: "auto" as const,
      whiteSpace: "pre-wrap" as const,
    },
    expandLine: {
      color: "#F87171",
      cursor: "pointer",
      marginTop: "8px",
    },
  };

  return (
    <div style={styles.container}>
      <div>
        <div style={styles.heading}>🔥 Error</div>
        <div style={styles.name}>{error.name}</div>
        <div style={styles.message}>{error.message}</div>
      </div>

      {stackLines.length > 0 && (
        <div>
          <div style={styles.sectionHeader}>
            <span>Stack trace</span>
            <button
              type="button"
              onClick={() => copyToClipboard(error.stack!)}
              style={styles.copyButton}
            >
              Copy all
            </button>
          </div>
          <pre style={styles.stackContainer}>
            {(expanded ? stackLines : previewLines).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {!expanded && hiddenLineCount > 0 && (
              <div  style={styles.expandLine} onClick={() => setExpanded(true)}>
                + {hiddenLineCount} more lines...
              </div>
            )}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ErrorViewer;

const ErrorViewerProduction = () => {
  const styles = {
    container: {
      padding: "24px",
      backgroundColor: "#FEF2F2",
      color: "#7F1D1D",
      border: "1px solid #FECACA",
      borderRadius: "16px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.05)",
      fontFamily: "monospace",
      maxWidth: "768px",
      margin: "40px auto",
      textAlign: "center" as const,
    },
    heading: {
      fontSize: "20px",
      fontWeight: "bold",
      marginBottom: "8px",
    },
    name: {
      fontSize: "16px",
      fontWeight: 600,
      marginBottom: "4px",
    },
    message: {
      fontSize: "14px",
      opacity: 0.85,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.heading}>🚨 An error occurred</div>
      <div style={styles.message}>
        Something went wrong. Please try again later.
      </div>
    </div>
  );
};
