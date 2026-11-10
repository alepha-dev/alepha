import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";

import { DevMcpSession } from "./DevMcpSession.ts";

/**
 * `alepha mcp`: call one of the selected app's actions, as a chosen user.
 *
 * One generic tool, not a tool per action (#E118, decision 4): a large app
 * has hundreds. The agent reads an action's shape with `app_describe`, and
 * the app's own validation answers a wrong input with its 400. The app runs
 * the call (`POST /actions/:name/call`), which refuses it in production.
 */
export class DevMcpActionTools {
  protected readonly session = $inject(DevMcpSession);

  protected readonly logNote =
    "(Called in process: no HTTP access line is logged. logs_tail shows only what the action itself logged.)";

  public readonly actionCall = $tool({
    name: "action_call",
    description:
      'Call one of the selected app\'s actions, in process, as a chosen user: its validation and middlewares run, so a $secure refusal comes back as the 401 or 403 that user would get. `action` is `group.name` or the bare name (app_map lists them, app_describe gives the input shape). `as` is "anonymous", { roles: ["admin"] } for a synthetic user, or { id } / { email } for an existing user of alepha/api/users. Answers with the status, the response body and the duration. The call does not pass through the HTTP server, so it writes no access log line: logs_tail shows only what the action itself logged. Development only.',
    annotations: { destructiveHint: true, openWorldHint: false },
    schema: {
      params: z.object({
        action: z.text().describe("`group.name` or the action's name"),
        params: z
          .record(z.text(), z.any())
          .describe("Path parameters")
          .optional(),
        query: z
          .record(z.text(), z.any())
          .describe("Query parameters")
          .optional(),
        body: z.any().describe("The request body").optional(),
        as: z
          .union([
            z.literal("anonymous"),
            z.object({ roles: z.array(z.text()) }),
            z.object({ id: z.text() }),
            z.object({ email: z.text() }),
          ])
          .describe('"anonymous", { roles: [...] }, { id } or { email }'),
      }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;

      const response = await target.connection.request(
        "POST",
        `/actions/${encodeURIComponent(params.action)}/call`,
        {
          params: params.params,
          query: params.query,
          body: params.body,
          as: params.as,
        },
      );

      // The route itself refused: production, an unknown action, an `as` it
      // cannot resolve.
      if (response.status !== 200) {
        const message =
          (response.body as { message?: string } | undefined)?.message ??
          `the inspector answered ${response.status}`;
        return `Not called: ${message}`;
      }

      const result = response.body as {
        status: number;
        body?: unknown;
        error?: string;
        durationMs: number;
      };
      const lines = [`${result.status} in ${Math.round(result.durationMs)} ms`];
      if (result.error && result.status >= 400) {
        lines.push(`Error: ${result.error}`);
      }
      if (result.body !== undefined) {
        lines.push("", JSON.stringify(result.body, null, 2));
      }
      // Said in the answer, not only in the description: an agent that
      // marks the logs, calls a quiet action and tails finds nothing, and
      // spent two more calls working out why.
      lines.push("", this.logNote);
      return lines.join("\n");
    },
  });
}
