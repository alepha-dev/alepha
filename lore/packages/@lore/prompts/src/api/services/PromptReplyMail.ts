import {
  type HostJobSummary,
  LoreInboxNotifications,
  NotificationHtmlEscaper,
  ProjectRecipients,
  PromptRegistry,
  ReplyMarkdownHtml,
} from "@lore/core/api";
import { hostJobs, projects } from "@lore/core/schemas";
import { $hook, $inject, Alepha } from "alepha";
import { $notification } from "alepha/api/notifications";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { prompts } from "../entities/prompts.ts";
import { promptReplyNotificationSchema } from "../schemas/promptReplyNotificationSchema.ts";

/**
 * A `member` arg emails the run's final reply to that member (#E174,
 * #Q4278), on any prompt, built-in or custom: a weekly status run every
 * Monday lands in the owner's mailbox.
 *
 * - Only a job that succeeded: a failure is `agent.job.failed`'s.
 * - The member must still be a member able to read the project at send
 *   time; otherwise nothing is sent and the job's warning says why.
 * - A reply Bay cut is sent as cut, with the link for the rest; a job with
 *   no reply (a host whose Bay predates it) still sends, saying so.
 * - The chrome is in the instance's notification language (Lore keeps no
 *   language per member); the reply is the agent's words.
 * - Copy never emails: only a run's end does.
 */
export class PromptReplyMail {
  /**
   * The email's chrome per notification language.
   */
  public static readonly CHROME: Record<
    string,
    {
      subject: string;
      open: string;
      cut: string;
      missing: string;
      footer: string;
    }
  > = {
    en: {
      subject: "reply",
      open: "Open the job in Lore",
      cut: "The reply was cut: the job's page has the rest.",
      missing:
        "The reply was not captured: the Agent host runs a Bay that returns none. Upgrade Bay on that host; the job's page has its log.",
      footer: "You receive this because the run named you in its member arg.",
    },
    fr: {
      subject: "réponse",
      open: "Ouvrir la tâche dans Lore",
      cut: "La réponse a été coupée : la page de la tâche a la suite.",
      missing:
        "La réponse n'a pas été récupérée : l'hôte Agent exécute un Bay qui n'en renvoie pas. Mettez Bay à jour sur cet hôte ; la page de la tâche a son journal.",
      footer:
        "Vous recevez ce message parce que l'exécution vous nomme dans son argument membre.",
    },
  };

  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly lang = $inject(LoreInboxNotifications).lang;
  protected readonly escaper = $inject(NotificationHtmlEscaper);
  protected readonly markdown = $inject(ReplyMarkdownHtml);
  protected readonly recipients = $inject(ProjectRecipients);
  protected readonly registry = $inject(PromptRegistry);
  protected readonly users = $repository(users);
  protected readonly projects = $repository(projects);
  protected readonly prompts = $repository(prompts);
  protected readonly jobs = $repository(hostJobs);

  public readonly email = $notification({
    name: "lore:prompt-reply:email",
    category: "notifications",
    description: "The final reply of a prompt's run that named you.",
    schema: promptReplyNotificationSchema,
    email: {
      subject: (it) =>
        `${it.projectTitle}: ${it.promptTitle}, ${this.chrome(it.lang).subject}`,
      body: (it) => {
        const chrome = this.chrome(it.lang);
        const project = this.escaper.escape(it.projectTitle);
        return `
        <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px;">${project}</p>
        <h1 style="margin: 0 0 16px; font-size: 20px;">${this.escaper.escape(it.promptTitle)}</h1>
        ${it.missing ? `<p style="margin: 0 0 12px;">${this.escaper.escape(chrome.missing)}</p>` : it.html}
        ${it.cut ? `<p style="margin: 12px 0; color: #6b7280;">${this.escaper.escape(chrome.cut)}</p>` : ""}
        <p style="margin: 24px 0;">
          <a href="${this.escaper.escape(encodeURI(it.url))}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            ${this.escaper.escape(chrome.open)}
          </a>
        </p>
        <p style="margin: 24px 0 0; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">${this.escaper.escape(chrome.footer)}</p>
      `;
      },
      text: (it) => {
        const chrome = this.chrome(it.lang);
        return [
          it.missing ? chrome.missing : it.text,
          ...(it.cut ? ["", chrome.cut] : []),
          "",
          `${chrome.open}: ${it.url}`,
          "",
          chrome.footer,
        ].join("\n");
      },
    },
  });

  protected chrome(lang: string) {
    return PromptReplyMail.CHROME[lang] ?? PromptReplyMail.CHROME.en!;
  }

  protected readonly onJobEnded = $hook({
    on: "host:job:ended",
    handler: async ({ job }) => {
      if (job.kind !== "agent" || job.status !== "succeeded") return;
      const member = job.args?.find((it) => it.type === "member");
      if (!member) return;
      await this.send(job, member.value).catch((error) =>
        this.log.warn("A run's reply could not be emailed", {
          job: job.id,
          error,
        }),
      );
    },
  });

  /**
   * Emails the job's reply to `memberId`, or says on the job why not.
   */
  public async send(job: HostJobSummary, memberId: string): Promise<boolean> {
    const refusal = await this.recipients.refusal(
      job.projectId,
      memberId,
      "project:read",
    );
    const account = refusal ? undefined : await this.users.findById(memberId);
    if (refusal || !account?.email) {
      await this.warn(
        job,
        `The reply was not emailed: ${refusal ?? "the member has no email address"}`,
      );
      return false;
    }
    const project = await this.projects.findOne({
      where: { id: { eq: job.projectId } },
    });
    const base = String(this.alepha.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
    const slug = project?.slug || `project-${job.projectId}`;
    const reply = job.result ?? "";
    await this.email.push({
      contact: account.email,
      lang: this.lang,
      variables: {
        projectTitle: project?.title ?? "",
        promptTitle: await this.titleOf(job),
        html: this.markdown.render(reply),
        text: reply,
        url: `${base}/${slug}/jobs/${job.id}`,
        lang: this.lang,
        cut: !!job.resultTruncated,
        missing: job.result === undefined,
      },
    });
    return true;
  }

  protected async titleOf(job: HostJobSummary): Promise<string> {
    if (!job.prompt) return "Agent job";
    const builtin = this.registry.get(job.prompt);
    if (builtin) return builtin.title;
    const row = await this.prompts.findOne({
      where: { projectId: { eq: job.projectId }, name: { eq: job.prompt } },
    });
    return row?.title ?? job.prompt;
  }

  /**
   * Appends a sentence to the job's warning.
   */
  protected async warn(job: HostJobSummary, line: string): Promise<void> {
    const warning = [job.warning, line]
      .filter(Boolean)
      .join(" ")
      .slice(0, 2000);
    await this.jobs.updateById(job.id, { warning });
  }
}
