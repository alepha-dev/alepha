import { useState } from "react";

import type { LogEntry } from "../../hooks/useLogTail.ts";
import { DetailFields } from "../declared/DetailFields.tsx";
import { detectEventType } from "./DevLogs.tsx";

export interface LogDetailProps {
  entry: LogEntry;
}

export const LogDetail = (props: LogDetailProps) => {
  const entry = props.entry;
  const kind = detectEventType(entry.data);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard
      .writeText(JSON.stringify(entry, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
  };

  return (
    <div>
      <div style={{ padding: "12px 14px" }}>
        <div
          className="dt-mono"
          style={{ fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.6 }}
        >
          {entry.message}
        </div>
        <button
          type="button"
          className="dt-btn"
          style={{ marginTop: 10 }}
          onClick={copy}
        >
          {copied ? "Copied" : "Copy as JSON"}
        </button>
      </div>

      <div className="dt-section-label">Entry</div>
      <DetailFields
        fields={[
          { label: "Level", value: entry.level },
          { label: "Module", value: entry.module },
          { label: "Service", value: entry.service },
          { label: "Context", value: entry.context },
          {
            label: "Timestamp",
            value: new Date(entry.timestamp).toISOString(),
          },
        ]}
      />

      {kind === "http" && (
        <>
          <div className="dt-section-label">HTTP</div>
          <DetailFields
            fields={[
              { label: "Method", value: entry.data?.method },
              { label: "Path", value: entry.data?.path },
              { label: "Status", value: String(entry.data?.status ?? "") },
              { label: "Duration", value: `${entry.data?.duration}ms` },
            ]}
          />
        </>
      )}

      {kind === "db" && (
        <>
          <div className="dt-section-label">Query</div>
          <DetailFields
            fields={[
              { label: "Operation", value: entry.data?.operation },
              {
                label: "Duration",
                value:
                  entry.data?.duration !== undefined
                    ? `${Math.round(entry.data.duration)}ms`
                    : undefined,
              },
            ]}
          />
        </>
      )}

      {entry.data && (
        <>
          <div className="dt-section-label">Data</div>
          <pre className="dt-pre">{JSON.stringify(entry.data, null, 2)}</pre>
        </>
      )}

      {entry.stack && (
        <>
          <div className="dt-section-label">Stack</div>
          <pre className="dt-pre" style={{ color: "var(--dt-error)" }}>
            {entry.stack}
          </pre>
        </>
      )}
    </div>
  );
};
