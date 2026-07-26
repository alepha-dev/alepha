import { z } from "alepha";
import { useInject } from "alepha/react";
import { useQueryParams } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import { Mail, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { OutboxDetail } from "./OutboxDetail.tsx";

export interface OutboxMessage {
  kind: "email" | "sms";
  to: string;
  subject?: string;
  body: string;
  sentAt: string;
}

const querySchema = z.object({
  selected: z.text().optional(),
  kind: z.text().optional(),
});

const relative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
};

/**
 * Everything the application sent outward, in one place.
 *
 * Emails and SMS were separate screens with identical layouts and separate
 * polls; in practice you want the outbound timeline, not one transport at a
 * time.
 */
export const DevOutbox = () => {
  const http = useInject(HttpClient);
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });
  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchAll = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const out: OutboxMessage[] = [];
    try {
      const res = await http.fetch("/__devtools/api/emails");
      for (const e of (res.data as any)?.emails ?? []) {
        out.push({ kind: "email", ...e });
      }
    } catch {
      // A missing transport is normal — an app need not send email.
    }
    try {
      const res = await http.fetch("/__devtools/api/sms");
      for (const s of (res.data as any)?.messages ?? []) {
        out.push({ kind: "sms", to: s.to, body: s.message, sentAt: s.sentAt });
      }
    } catch {
      // Same: SMS is optional.
    }
    out.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    setMessages(out);
    setLoaded(true);
  }, [http]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const kindFilter = params.kind ?? "";
  const visible = useMemo(
    () => messages.filter((m) => !kindFilter || m.kind === kindFilter),
    [messages, kindFilter],
  );

  const selected = useMemo(
    () => visible.find((m) => `${m.kind}:${m.sentAt}` === params.selected),
    [visible, params.selected],
  );

  if (loaded && messages.length === 0) {
    return (
      <DevEmpty
        title="Nothing sent yet"
        hint="Emails and SMS sent in development are written to node_modules/.alepha"
      />
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
      <div className="dt-rail" style={{ width: 320 }}>
        <div className="dt-section-label" style={{ borderTop: 0 }}>
          Captured
          <span style={{ letterSpacing: 0 }}>· {messages.length}</span>
          <span className="dt-seg" style={{ marginLeft: "auto" }}>
            {[
              { value: "", label: "All" },
              { value: "email", label: "Email" },
              { value: "sms", label: "SMS" },
            ].map((f) => (
              <button
                key={f.value || "all"}
                type="button"
                className="dt-seg-item"
                data-on={kindFilter === f.value || undefined}
                onClick={() =>
                  setParams({ ...params, kind: f.value || undefined })
                }
              >
                {f.label}
              </button>
            ))}
          </span>
        </div>

        <div className="dt-rail-body">
          {visible.map((m) => {
            const key = `${m.kind}:${m.sentAt}`;
            return (
              <button
                key={key}
                type="button"
                className="dt-leaf"
                style={{
                  paddingLeft: 12,
                  alignItems: "flex-start",
                  flexDirection: "column",
                  gap: 2,
                }}
                data-active={params.selected === key || undefined}
                onClick={() => setParams({ ...params, selected: key })}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                  }}
                >
                  {m.kind === "email" ? (
                    <Mail size={11} style={{ color: "var(--dt-info)" }} />
                  ) : (
                    <MessageSquare
                      size={11}
                      style={{ color: "var(--dt-get)" }}
                    />
                  )}
                  {/*
                   * Subject first, recipient underneath. Recipients here are
                   * long generated addresses that pushed the timestamp off the
                   * right edge, and they are also the less identifying half —
                   * you look for "the invite email", not for
                   * `inviter-1785100491756@example.com`.
                   */}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.subject ?? m.body.slice(0, 48)}
                  </span>
                  <span className="dt-nav-count">{relative(m.sentAt)}</span>
                </span>
                <span
                  className="dt-mono"
                  style={{
                    fontSize: 10,
                    color: "var(--dt-fg-faint)",
                    paddingLeft: 17,
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.to}
                </span>
              </button>
            );
          })}
        </div>

        {/*
         * Where these came from. Nothing in the app tells you that a "sent"
         * email landed on disk instead of in an inbox, and the path is what
         * you need when you go looking outside devtools.
         */}
        <div
          className="dt-mono"
          style={{
            flex: "none",
            padding: "8px 12px",
            borderTop: "1px solid var(--dt-border-soft)",
            fontSize: 9,
            lineHeight: 1.6,
            color: "var(--dt-fg-faint)",
          }}
        >
          node_modules/.alepha/emails
          <br />
          node_modules/.alepha/sms
        </div>
      </div>

      <div className="dt-detail">
        {selected ? (
          <OutboxDetail message={selected} />
        ) : (
          <DevEmpty title="Select a message" />
        )}
      </div>
    </div>
  );
};

export default DevOutbox;
