import type { HostJobController } from "@lore/core/api";
import { AgentTranscript, type AgentTranscriptEntry } from "@lore/core/schemas";
import { useClient, useQuery } from "alepha/react";

/**
 * The last line of a running job's transcript (#Q4514), for a row of the
 * header's jobs list: read only while the list is open, every 3 s, and only
 * from the end of the log (`tail`), never the whole of it.
 */
export const useJobLastLine = (
  jobId: string,
  agent: string | undefined,
  enabled: boolean,
): string | undefined => {
  const api = useClient<HostJobController>();
  const query = useQuery(
    {
      enabled,
      key: ["host-job-last-line", jobId],
      keepPreviousData: true,
      runEvery: enabled ? 3000 : undefined,
      handler: async () => {
        const part = await api.getJobLog({
          params: { jobId },
          query: { tail: TAIL_BYTES },
        });
        // A read from the middle starts inside a line: drop it.
        const text =
          (part.start ?? 0) > 0
            ? part.stdout.slice(part.stdout.indexOf("\n") + 1)
            : part.stdout;
        const entries = AgentTranscript.parse(text, agent).entries;
        for (const entry of entries.toReversed()) {
          const line = lineOf(entry);
          if (line) return line;
        }
        return "";
      },
      onError: () => {},
    },
    [api, jobId, agent, enabled],
  );
  return query.data || undefined;
};

/**
 * How much of the log's end a last line is looked for in.
 */
const TAIL_BYTES = 8192;

/**
 * One transcript entry as one line: what the agent said, or the tool it
 * ran last and on what.
 */
const lineOf = (entry: AgentTranscriptEntry): string | undefined => {
  const first = (text: string) => text.trim().split("\n").at(-1)?.trim();
  switch (entry.kind) {
    case "text":
    case "message":
    case "limit":
      return first(entry.text);
    case "raw":
      return first(entry.line);
    case "tools": {
      const tool = entry.tools.at(-1);
      return tool
        ? [tool.name, tool.detail].filter(Boolean).join(" ")
        : undefined;
    }
    default:
      return undefined;
  }
};
