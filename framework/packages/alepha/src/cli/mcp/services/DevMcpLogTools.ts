import { $inject, z } from "alepha";
import type { InspectorConnection, InspectorLogEntry } from "alepha/inspector";
import { $tool } from "alepha/mcp";

import { DevMcpSession } from "./DevMcpSession.ts";

/**
 * `alepha mcp`: the selected app's logs, and the emails and SMS it captured
 * in its local outbox.
 *
 * Log markers are sequence numbers (#E118, decision 6): `logs_mark` returns
 * the newest `seq`, and `logs_tail({ since })` reads the route's `after`
 * cursor, page by page while `hasMore` says so, so a burst after a marker is
 * not cut to one page.
 */
export class DevMcpLogTools {
  protected readonly session = $inject(DevMcpSession);

  /**
   * How many entries a tail collects after a marker before it stops paging.
   */
  protected readonly maxCollected = 5000;

  protected readonly levels = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];

  public readonly logsTail = $tool({
    name: "logs_tail",
    description:
      "The selected app's latest log entries, oldest first (a dead run's too, from its log file). Filter by minimum `level`, `logger` (the module), `text`, `slowerThan` (ms, for requests and queries) and `since` (a marker from logs_mark: only what was logged after it). Each line is `seq time LEVEL logger: message`; `full: true` adds the entry's data and error stack.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        limit: z
          .integer()
          .min(1)
          .max(1000)
          .describe("How many entries, the newest ones (default 50)")
          .optional(),
        level: z
          .enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"])
          .describe("Minimum level")
          .optional(),
        logger: z
          .text()
          .describe(
            "Only this module, as printed between the level and the message",
          )
          .optional(),
        text: z
          .text()
          .describe("Every word must appear in the message, module or service")
          .optional(),
        slowerThan: z
          .integer()
          .describe("Only entries with a duration of at least this many ms")
          .optional(),
        since: z
          .integer()
          .describe("A marker from logs_mark: only entries logged after it")
          .optional(),
        full: z
          .boolean()
          .describe("Add each entry's data and error stack")
          .optional(),
      }),
    },
    handler: async ({ params }) => {
      const target = await this.session.logTarget();
      if (!target.connection) return target.answer;
      const limit = params.limit ?? 50;
      const { entries, total } = await this.read(target.connection, params);
      if (!entries.length) {
        if (params.since === undefined) return "No log entry matches.";
        // "Nothing matching" with no filter reads as a filter that hid
        // something: with `since` alone, nothing was logged at all.
        return this.filtered(params)
          ? `Nothing matching was logged after marker ${params.since}.`
          : `Nothing was logged after marker ${params.since}.`;
      }
      const shown = entries.slice(-limit);
      const lines = shown.map((entry) => this.line(entry, !!params.full));
      if (total > shown.length) {
        // A live run's total counts the history it restored from the run
        // before it, which is numbered below zero: "5 of 155" while the
        // newest seq is 45 otherwise reads as 110 entries gone missing.
        const history =
          params.since === undefined && target.connection.run.status !== "dead"
            ? " (the total counts the previous run's restored history, numbered below zero)"
            : "";
        lines.unshift(
          `Showing the newest ${shown.length} of ${total} matching entries${history}; raise \`limit\` or narrow the filters for the rest.`,
          "",
        );
      }
      return lines.join("\n");
    },
  });

  public readonly logsMark = $tool({
    name: "logs_mark",
    description:
      "A marker for the selected app's logs: the sequence number of its newest entry. Call it before an action, then logs_tail({ since: marker }) shows only what that action logged.",
    annotations: { readOnlyHint: true },
    handler: async () => {
      const target = await this.session.logTarget();
      if (!target.connection) return target.answer;
      const page = await target.connection.logs({ limit: "1" });
      const newest = (page.logs as InspectorLogEntry[])[0];
      // Restored history is numbered below zero: "nothing yet" is below it.
      const marker = newest?.seq ?? Number.MIN_SAFE_INTEGER;
      return `Marker: ${marker}. Pass \`since: ${marker}\` to logs_tail for what is logged from now on.`;
    },
  });

  public readonly emailsList = $tool({
    name: "emails_list",
    description:
      "The emails the selected app captured in its local outbox (alepha dev writes them instead of sending), newest first: id, to, subject, sent at. Read one in full with email_read.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        limit: z.integer().min(1).max(200).optional(),
        to: z.text().describe("Only those sent to this address").optional(),
      }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const { emails, directory } = await target.connection.call("emails");
      const kept = emails
        .filter((email) => !params.to || email.to.includes(params.to))
        .slice(0, params.limit ?? 20);
      if (!kept.length) return `No email in the outbox (${directory}).`;
      return kept
        .map(
          (email) =>
            `- ${email.id} - to ${email.to} - "${email.subject}" - ${email.sentAt}`,
        )
        .join("\n");
    },
  });

  public readonly emailRead = $tool({
    name: "email_read",
    description:
      "One captured email in full, by the id emails_list gives: its HTML body and text part, to follow a magic link or check a template.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({ id: z.text({ size: "long" }) }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const { emails } = await target.connection.call("emails");
      const email = emails.find((it) => it.id === params.id);
      if (!email)
        return `No email "${params.id}" in the outbox: emails_list gives the ids.`;
      return [
        `To: ${email.to}`,
        `Subject: ${email.subject}`,
        `Sent: ${email.sentAt}`,
        "",
        email.body,
        ...(email.text ? ["", "--- text part ---", email.text] : []),
      ].join("\n");
    },
  });

  public readonly smsList = $tool({
    name: "sms_list",
    description:
      "The SMS the selected app captured in its local outbox, newest first: id, to, sent at and the start of the message. Read one in full with sms_read.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        limit: z.integer().min(1).max(200).optional(),
        to: z.text().describe("Only those sent to this number").optional(),
      }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const { messages, directory } = await target.connection.call("sms");
      const kept = messages
        .filter((sms) => !params.to || sms.to.includes(params.to))
        .slice(0, params.limit ?? 20);
      if (!kept.length) return `No SMS in the outbox (${directory}).`;
      return kept
        .map(
          (sms) =>
            `- ${sms.id} - to ${sms.to} - ${sms.sentAt} - ${this.clip(sms.message, 60)}`,
        )
        .join("\n");
    },
  });

  public readonly smsRead = $tool({
    name: "sms_read",
    description: "One captured SMS in full, by the id sms_list gives.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({ id: z.text({ size: "long" }) }),
    },
    handler: async ({ params }) => {
      const target = await this.session.target();
      if (!target.connection) return target.answer;
      const { messages } = await target.connection.call("sms");
      const sms = messages.find((it) => it.id === params.id);
      if (!sms)
        return `No SMS "${params.id}" in the outbox: sms_list gives the ids.`;
      return [`To: ${sms.to}`, `Sent: ${sms.sentAt}`, "", sms.message].join(
        "\n",
      );
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The matching entries, oldest first, and how many matched.
   *
   * A live run filters on its side: without `since`, one page of the newest
   * `limit`; with it, every page after the marker. A dead run's file is read
   * whole and filtered here, since only the level filter applies to it there.
   */
  protected async read(
    connection: InspectorConnection,
    params: {
      limit?: number;
      level?: string;
      logger?: string;
      text?: string;
      slowerThan?: number;
      since?: number;
    },
  ): Promise<{ entries: InspectorLogEntry[]; total: number }> {
    const limit = params.limit ?? 50;
    if (connection.run.status === "dead") {
      const page = await connection.logs({
        level: params.level,
        limit: String(Number.MAX_SAFE_INTEGER),
      });
      const entries = (page.logs as InspectorLogEntry[])
        .filter((entry) => this.matches(entry, params))
        .toReversed();
      return { entries, total: entries.length };
    }

    const filters = {
      level: params.level,
      module: params.logger,
      search: params.text,
      slowerThan:
        params.slowerThan === undefined ? undefined : String(params.slowerThan),
    };

    if (params.since === undefined) {
      const page = await connection.logs({ ...filters, limit: String(limit) });
      return {
        entries: (page.logs as InspectorLogEntry[]).toReversed(),
        total: page.total,
      };
    }

    const entries: InspectorLogEntry[] = [];
    let cursor = params.since;
    while (entries.length < this.maxCollected) {
      const page = await connection.logs({
        ...filters,
        after: String(cursor),
        limit: "200",
      });
      // Each page is newest first.
      const batch = (page.logs as InspectorLogEntry[]).toReversed();
      entries.push(...batch);
      cursor = batch.at(-1)?.seq ?? cursor;
      if (!page.hasMore || !batch.length) break;
    }
    return { entries, total: entries.length };
  }

  /**
   * Whether anything but `since` and `limit` narrows the tail.
   */
  protected filtered(params: {
    level?: string;
    logger?: string;
    text?: string;
    slowerThan?: number;
  }): boolean {
    return (
      params.level !== undefined ||
      params.logger !== undefined ||
      params.text !== undefined ||
      params.slowerThan !== undefined
    );
  }

  /**
   * The route's own filters, for a dead run's file.
   */
  protected matches(
    entry: InspectorLogEntry,
    params: {
      logger?: string;
      text?: string;
      slowerThan?: number;
      since?: number;
    },
  ): boolean {
    if (params.since !== undefined && entry.seq <= params.since) return false;
    if (params.logger && entry.module !== params.logger) return false;
    if (params.text) {
      const haystack =
        `${entry.message} ${entry.module} ${entry.service}`.toLowerCase();
      const words = params.text.toLowerCase().split(/\s+/);
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    if (params.slowerThan !== undefined) {
      const duration = (entry.data as { duration?: unknown } | undefined)
        ?.duration;
      if (typeof duration !== "number" || duration < params.slowerThan) {
        return false;
      }
    }
    return true;
  }

  protected line(entry: InspectorLogEntry, full: boolean): string {
    const time = Number.isFinite(entry.timestamp)
      ? new Date(entry.timestamp).toISOString().slice(11, 23)
      : "";
    const head = `${entry.seq} ${time} ${entry.level} ${entry.module}: ${entry.message}`;
    if (!full) return head;
    const parts = [head];
    if (entry.data !== undefined && entry.data !== null) {
      parts.push(`  data: ${JSON.stringify(entry.data)}`);
    }
    if (entry.stack) {
      parts.push(`  stack: ${entry.stack.split("\n").join("\n    ")}`);
    }
    return parts.join("\n");
  }

  protected clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  }
}
