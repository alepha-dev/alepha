import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { EnvVariable } from "./DevEnvironment.tsx";

const SENSITIVE = ["secret", "password", "key", "token", "salt", "credential"];

const isSensitive = (name: string): boolean => {
  const lower = name.toLowerCase();
  return SENSITIVE.some((p) => lower.includes(p));
};

export interface EnvLineProps {
  variable: EnvVariable;
}

/**
 * One variable, rendered as a line of a `.env` file.
 *
 * The blur on a sensitive value is a shoulder-surfing guard, not a security
 * control: devtools serves environment values to the browser in cleartext by
 * design, and the module refuses to register in production for exactly that
 * reason.
 */
export const EnvLine = (props: EnvLineProps) => {
  const v = props.variable;
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasValue = v.value !== undefined && v.value !== "";
  const sensitive = isSensitive(v.name);
  const unsetRequired = v.required && !hasValue;

  const copy = () => {
    navigator.clipboard.writeText(String(v.value ?? "")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ marginBottom: 10 }}>
      {v.description?.split("\n").map((line, i) => (
        <div
          key={i}
          className="dt-mono"
          style={{
            fontSize: 10,
            fontStyle: "italic",
            color: "var(--dt-fg-faint)",
            lineHeight: 1.6,
          }}
        >
          # {line}
        </div>
      ))}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          lineHeight: 1.8,
        }}
      >
        <span
          className="dt-mono"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: unsetRequired ? "var(--dt-warn)" : "var(--dt-accent)",
          }}
        >
          {v.name}
        </span>
        <span className="dt-mono" style={{ color: "var(--dt-fg-faint)" }}>
          =
        </span>

        {hasValue ? (
          <span
            className="dt-mono"
            style={{
              fontSize: 11,
              filter: sensitive && !revealed ? "blur(4px)" : undefined,
              cursor: sensitive ? "pointer" : undefined,
              transition: "filter .12s",
            }}
            onMouseEnter={() => sensitive && setRevealed(true)}
            onMouseLeave={() => sensitive && setRevealed(false)}
          >
            {String(v.value)}
          </span>
        ) : (
          <span
            className="dt-mono"
            style={{
              fontSize: 11,
              fontStyle: "italic",
              color: unsetRequired ? "var(--dt-warn)" : "var(--dt-fg-faint)",
            }}
          >
            {unsetRequired ? "(required — not set)" : "(not set)"}
          </span>
        )}

        <span className="dt-chip">{v.format || v.type}</span>
        {v.required && (
          <span className="dt-chip" data-tone="accent">
            required
          </span>
        )}
        {v.defaultValue !== undefined && !hasValue && (
          <span className="dt-chip">default: {String(v.defaultValue)}</span>
        )}

        {hasValue && (
          <button
            type="button"
            className="dt-schema-toggle"
            style={{ width: "auto" }}
            onClick={copy}
            title="Copy value"
          >
            {copied ? (
              <Check size={11} style={{ color: "var(--dt-get)" }} />
            ) : (
              <Copy size={11} />
            )}
          </button>
        )}
      </div>
    </div>
  );
};
