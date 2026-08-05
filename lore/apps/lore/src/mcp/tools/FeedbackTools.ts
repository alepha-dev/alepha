import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { FeedbackController } from "../../api/controllers/FeedbackController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import type { FeedbackResource } from "../../api/schemas/feedbackResourceSchema.ts";
import {
  feedbackAttachmentGetParamsSchema,
  feedbackGetParamsSchema,
  feedbackGetResultSchema,
  feedbackListParamsSchema,
  feedbackListResultSchema,
  feedbackTriageParamsSchema,
  feedbackTriageResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for feedback — user-submitted bug/feature requests that the
 * project owner triages. Owner-only operations: list the inbox, inspect an
 * item, and accept or reject. Promoting feedback to a quest is a separate
 * quest_create call with `feedbackId` set.
 */
export class FeedbackTools {
  protected readonly feedbackController = $inject(FeedbackController);
  protected readonly projectController = $inject(ProjectController);

  protected async resolveProjectId(
    project?: number,
    projectName?: string,
  ): Promise<number> {
    const projects = await this.projectController.getMyProjects();

    if (project) {
      const found = projects.find((p) => p.id === project);
      if (!found) {
        throw new NotFoundError(`Project with ID ${project} not found`);
      }
      return found.id;
    }

    if (projectName) {
      const found = projects.find(
        (p) => p.title.toLowerCase() === projectName.toLowerCase(),
      );
      if (!found) {
        throw new NotFoundError(`Project "${projectName}" not found`);
      }
      return found.id;
    }

    throw new BadRequestError(
      "Project is required. Specify project ID or project_name.",
    );
  }

  protected reporterName(feedback: FeedbackResource): string | undefined {
    const reporter = feedback.reporter;
    if (!reporter) return undefined;
    return reporter.name || reporter.username || undefined;
  }

  /**
   * Resolve either a global `id` or a per-project `shortId` (with project
   * context) to the underlying global id.
   */
  protected async resolveFeedbackId(
    projectId: number,
    params: { id?: number; shortId?: number },
  ): Promise<number> {
    if (params.id != null) return params.id;
    if (params.shortId != null) {
      const result = await this.feedbackController.listFeedback({
        params: { projectId },
        query: { status: "all" },
      });
      const found = result.items.find((p) => p.shortId === params.shortId);
      if (!found) {
        throw new NotFoundError(
          `Feedback with shortId ${params.shortId} not found in project`,
        );
      }
      return found.id;
    }
    throw new BadRequestError(
      "Feedback reference required: pass `id` (global) or `shortId` (per-project — also requires `project` or `project_name`).",
    );
  }

  feedback_list = $tool({
    description:
      "List feedback (user-submitted bug/feature requests) for a project. Owner-only. Defaults to status 'pending' — the inbox the owner needs to triage. Pass status='all' to see everything.",
    title: "List feedback",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: feedbackListParamsSchema,
      result: feedbackListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const result = await this.feedbackController.listFeedback({
        params: { projectId },
        query: { status: params.status },
      });

      return {
        feedback: result.items.map((p) => ({
          id: p.id,
          shortId: p.shortId,
          title: p.title,
          tags: p.tags ?? [],
          status: p.status,
          reporterName: this.reporterName(p),
          linkedQuestCount: p.linkedQuests?.length ?? 0,
          createdAt: p.createdAt,
        })),
      };
    },
  });

  feedback_get = $tool({
    description:
      "Get full details of one feedback item by ID, including description, reporter, tags (free-form key=value pairs like type=bug, host=lore.alepha.dev, path=/foo), attachments (id/name/mimeType/size — fetch their content with feedback_attachment_get), and linked quests spawned from it.",
    title: "Get feedback",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: feedbackGetParamsSchema,
      result: feedbackGetResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const feedbackId = await this.resolveFeedbackId(projectId, params);
      const p = await this.feedbackController.getFeedback({
        params: { projectId, feedbackId },
      });

      return {
        id: p.id,
        shortId: p.shortId,
        title: p.title,
        description: p.description,
        tags: p.tags ?? [],
        status: p.status,
        reporterName: this.reporterName(p),
        attachments: (p.attachmentUrls ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
        })),
        linkedQuests: (p.linkedQuests ?? []).map((q) => ({
          id: q.id,
          shortId: q.shortId,
          title: q.title,
          status: q.status,
        })),
        createdAt: p.createdAt,
      };
    },
  });

  feedback_attachment_get = $tool({
    description:
      "Fetch the actual content of one feedback attachment. Owner/member-only. For images the bytes are returned inline as an image block — so a screenshot attached to a bug report can be viewed directly. For text-like files (txt/csv/json) the decoded text is returned; other binary types (pdf, xlsx, …) return a metadata note only. Pass `attachmentId` from a feedback_get `attachments[].id`.",
    title: "Get feedback attachment",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: feedbackAttachmentGetParamsSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const feedbackId = await this.resolveFeedbackId(projectId, params);
      const file = await this.feedbackController.getFeedbackAttachment({
        params: { projectId, feedbackId, attachmentId: params.attachmentId },
      });

      if (file.mimeType.startsWith("image/")) {
        return {
          content: [
            { type: "image", data: file.data, mimeType: file.mimeType },
          ],
        };
      }

      // Text-like payloads are decoded inline so the agent can read them;
      // opaque binary types (pdf/xlsx/…) return metadata only.
      if (/^(text\/|application\/(json|csv))/.test(file.mimeType)) {
        const text = Buffer.from(file.data, "base64").toString("utf8");
        return {
          content: [
            {
              type: "text",
              text: `${file.name} (${file.mimeType}, ${file.size} bytes):\n\n${text}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Attachment "${file.name}" is ${file.mimeType} (${file.size} bytes) — not inline-viewable here. Download it from the Lore inbox if you need the raw file.`,
          },
        ],
      };
    },
  });

  feedback_accept = $tool({
    description:
      "Accept a pending feedback item — owner declares the request valid. Status flips pending → accepted. Quests are created separately via quest_create with feedbackId set.",
    title: "Accept feedback",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: feedbackTriageParamsSchema,
      result: feedbackTriageResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const feedbackId = await this.resolveFeedbackId(projectId, params);
      const result = await this.feedbackController.acceptFeedback({
        params: { projectId, feedbackId },
      });

      return { ok: result.ok };
    },
  });

  feedback_reject = $tool({
    description:
      "Reject a pending feedback item. Soft state transition — the row remains for audit.",
    title: "Reject feedback",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: feedbackTriageParamsSchema,
      result: feedbackTriageResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const feedbackId = await this.resolveFeedbackId(projectId, params);
      const result = await this.feedbackController.rejectFeedback({
        params: { projectId, feedbackId },
      });

      return { ok: result.ok };
    },
  });
}
