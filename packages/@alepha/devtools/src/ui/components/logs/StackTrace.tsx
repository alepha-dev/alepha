import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useState } from "react";

import { useCurrentRun } from "../../hooks/useCurrentRun.ts";
import { useRunId } from "../../hooks/useRunId.ts";

export interface StackTraceProps {
  stack: string;
}

/**
 * A stack trace whose frames in the app's own code open in the editor.
 *
 * A frame is a link when its file sits inside the run's directory and not
 * under `node_modules`; `node:` internals and dependencies stay plain text.
 * The devtools server checks the same rule again before opening anything.
 */
export const StackTrace = (props: StackTraceProps) => {
  const http = useInject(HttpClient);
  const runId = useRunId();
  const run = useCurrentRun();
  const [message, setMessage] = useState<string | undefined>();

  const root = run ? `${run.cwd.replace(/[\\/]$/, "")}/` : undefined;
  const lines = props.stack.split("\n");

  const open = async (file: string, line: number, column: number) => {
    setMessage(undefined);
    try {
      const res = await http.fetch(
        `/apps/${encodeURIComponent(runId)}/editor`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file, line, column }),
        },
      );
      setMessage(`Opened in ${(res.data as any)?.editor ?? "the editor"}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <pre className="dt-pre" style={{ color: "var(--dt-error)" }}>
        {lines.map((text, index) => {
          const frame = /(?:file:\/\/)?(\/[^()\s]+?):(\d+):(\d+)\)?\s*$/.exec(
            text,
          );
          const file = frame?.[1];
          const linkable =
            !!file &&
            !!root &&
            file.startsWith(root) &&
            !file.includes("/node_modules/");
          return (
            <span key={index}>
              {linkable ? (
                <button
                  type="button"
                  className="dt-link"
                  title={`Open ${file}:${frame![2]} in the editor`}
                  onClick={() =>
                    void open(file!, Number(frame![2]), Number(frame![3]))
                  }
                >
                  {text}
                </button>
              ) : (
                text
              )}
              {index < lines.length - 1 ? "\n" : ""}
            </span>
          );
        })}
      </pre>
      {message && <div className="dt-section-sub">{message}</div>}
    </>
  );
};
