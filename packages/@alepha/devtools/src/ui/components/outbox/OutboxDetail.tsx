import { useState } from "react";
import { DetailFields } from "../declared/DetailFields.tsx";
import type { OutboxMessage } from "./DevOutbox.tsx";

export interface OutboxDetailProps {
  message: OutboxMessage;
}

export const OutboxDetail = (props: OutboxDetailProps) => {
  const m = props.message;
  const [raw, setRaw] = useState(false);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 14px 10px",
        }}
      >
        <span className="dt-mono" style={{ fontSize: 14 }}>
          {m.subject ?? m.to}
        </span>
        <span className="dt-chip">{m.kind}</span>
      </div>

      <div className="dt-section-label">Envelope</div>
      <DetailFields
        fields={[
          { label: "To", value: m.to },
          { label: "Subject", value: m.subject },
          { label: "Sent at", value: new Date(m.sentAt).toLocaleString() },
        ]}
      />

      <div className="dt-section-label">
        Body
        <button
          type="button"
          className="dt-schema-toggle"
          style={{ marginLeft: "auto", width: "auto" }}
          onClick={() => setRaw(!raw)}
          title={raw ? "Render" : "Show source"}
        >
          {"{ }"}
        </button>
      </div>

      {m.kind === "sms" || raw ? (
        <pre className="dt-pre" style={{ whiteSpace: "pre-wrap" }}>
          {m.body}
        </pre>
      ) : (
        <div style={{ padding: 14 }}>
          <div
            style={{
              background: "#fff",
              color: "#111",
              padding: 14,
              borderRadius: 2,
            }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: devtools renders the developer's own outgoing email, in their own dev environment
            dangerouslySetInnerHTML={{ __html: m.body }}
          />
        </div>
      )}
    </div>
  );
};
