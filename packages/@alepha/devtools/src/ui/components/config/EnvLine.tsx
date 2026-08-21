import { AlertTriangle, Check, Copy } from "lucide-react";
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

  /**
   * A value present but unparseable against its declared type. This is the
   * quiet failure the screen exists for: the app booted, the default silently
   * took over, and nothing anywhere says so.
   */
  const mistyped =
    hasValue &&
    (v.type === "integer" || v.type === "number") &&
    !Number.isFinite(Number(v.value));

  const copy = () => {
    void navigator.clipboard.writeText(String(v.value ?? "")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="dt-env-line"
      data-state={mistyped ? "invalid" : unsetRequired ? "missing" : undefined}
    >
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
          gap: 0,
          lineHeight: 1.8,
        }}
      >
        {/*
         * `NAME=value` with no spaces, so the line is copy-pasteable into a
         * .env file as it stands rather than being a rendering of one.
         */}
        <span className="dt-mono dt-env-name">{v.name}</span>
        <span className="dt-mono" style={{ color: "var(--dt-fg-faint)" }}>
          =
        </span>

        {hasValue ? (
          <span
            className="dt-mono"
            style={{
              fontSize: 11,
              color: valueColor(v),
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
            (not set)
          </span>
        )}

        {/*
         * Type and constraints are reference, not content — parked at the far
         * right so the eye can run straight down the names and values.
         */}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <span className="dt-chip">{v.format || v.type}</span>
          {v.required && (
            <span className="dt-chip" data-tone="warn">
              required
            </span>
          )}
          {v.defaultValue !== undefined && (
            <span className="dt-chip">default: {String(v.defaultValue)}</span>
          )}

          <button
            type="button"
            className="dt-schema-toggle"
            style={{
              width: "auto",
              visibility: hasValue ? undefined : "hidden",
            }}
            onClick={copy}
            title="Copy value"
          >
            {copied ? (
              <Check size={11} style={{ color: "var(--dt-get)" }} />
            ) : (
              <Copy size={11} />
            )}
          </button>
        </span>
      </div>

      {mistyped && (
        <div className="dt-env-note" style={{ color: "var(--dt-danger)" }}>
          <AlertTriangle size={10} />
          Expected {v.type}, received "{String(v.value)}".
          {v.defaultValue !== undefined
            ? ` Falling back to the default of ${String(v.defaultValue)}.`
            : " There is no default to fall back to."}
        </div>
      )}

      {unsetRequired && (
        <div className="dt-env-note" style={{ color: "var(--dt-warn)" }}>
          <AlertTriangle size={10} />
          Required, and not set. Whatever reads it will throw on first use.
        </div>
      )}
    </div>
  );
};

/**
 * Values are tinted by what they are, so a port, a URL and an unset variable
 * are distinguishable without reading them.
 */
const valueColor = (v: EnvVariable): string => {
  if (v.type === "boolean") return "var(--dt-patch)";
  if (v.type === "integer" || v.type === "number") return "var(--dt-get)";
  return "var(--dt-fg)";
};
