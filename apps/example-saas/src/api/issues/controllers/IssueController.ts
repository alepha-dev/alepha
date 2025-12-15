import { type Page, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action, okSchema } from "alepha/server";
import { type IssueMessage, issueMessages } from "../entities/issueMessages.ts";
import { type Issue, issues } from "../entities/issues.ts";

/**
 * Controller for managing issues (support tickets).
 *
 * Issues follow this workflow:
 * OPEN → PENDING (when assigned) → ACCEPTED/REJECTED → ARCHIVED
 * Any state can transition to CANCELLED.
 */
export class IssueController {
  protected readonly log = $logger();
  protected readonly issues = $repository(issues);
  protected readonly messages = $repository(issueMessages);

  // ─────────────────────────────────────────────────────────────────────────────
  // List & Search
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all issues with pagination and filtering.
   * GET /admin/issues
   */
  findIssues = $action({
    path: "/admin/issues",
    secure: false,
    description: "Find all issues with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        sort: t.optional(t.text()),
        query: t.optional(t.text()),
        status: t.optional(
          t.enum([
            "open",
            "pending",
            "accepted",
            "rejected",
            "cancelled",
            "archived",
          ]),
        ),
        priority: t.optional(t.enum(["low", "medium", "high", "urgent"])),
        creatorType: t.optional(t.enum(["system", "customer", "agent"])),
        assignedAgentId: t.optional(t.uuid()),
        customerId: t.optional(t.uuid()),
        bookingId: t.optional(t.uuid()),
        parentIssueId: t.optional(t.uuid()),
        category: t.optional(t.text()),
      }),
      response: t.page(issues.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.status) {
        where.status = { eq: query.status };
      }

      if (query.priority) {
        where.priority = { eq: query.priority };
      }

      if (query.creatorType) {
        where.creatorType = { eq: query.creatorType };
      }

      if (query.assignedAgentId) {
        where.assignedAgentId = { eq: query.assignedAgentId };
      }

      if (query.customerId) {
        where.customerId = { eq: query.customerId };
      }

      if (query.bookingId) {
        where.bookingId = { eq: query.bookingId };
      }

      if (query.parentIssueId) {
        where.parentIssueId = { eq: query.parentIssueId };
      }

      if (query.category) {
        where.category = { eq: query.category };
      }

      if (query.query) {
        where.or = [
          { title: { ilike: `%${query.query}%` } },
          { description: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.issues.paginate(
        { page, size, sort: query.sort },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [
            { column: "priority", direction: "desc" }, // Urgent first
            { column: "createdAt", direction: "desc" },
          ],
        },
      );

      return result as Page<Issue>;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Get Single Issue
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a single issue by ID.
   * GET /admin/issues/:id
   */
  getIssue = $action({
    path: "/admin/issues/:id",
    secure: false,
    description: "Get an issue by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: issues.schema,
    },
    handler: async ({ params }) => {
      return await this.issues.findById(params.id);
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Get Child Issues
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get child issues of a parent issue.
   * GET /admin/issues/:id/children
   */
  getChildIssues = $action({
    path: "/admin/issues/:id/children",
    secure: false,
    description: "Get child issues",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.array(issues.schema),
    },
    handler: async ({ params }) => {
      return await this.issues.findMany({
        where: { parentIssueId: { eq: params.id } },
        orderBy: [{ column: "createdAt", direction: "asc" }],
      });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Create Issue
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new issue.
   * POST /admin/issues
   */
  createIssue = $action({
    method: "POST",
    path: "/admin/issues",
    secure: false,
    description: "Create a new issue",
    schema: {
      body: t.object({
        title: t.text({ minLength: 1, maxLength: 500 }),
        description: t.optional(t.text({ maxLength: 10000 })),
        creatorType: t.enum(["system", "customer", "agent"]),
        creatorId: t.optional(t.uuid()),
        customerId: t.optional(t.uuid()),
        bookingId: t.optional(t.uuid()),
        parentIssueId: t.optional(t.uuid()),
        priority: t.optional(t.enum(["low", "medium", "high", "urgent"])),
        tags: t.optional(t.array(t.text())),
        category: t.optional(t.text()),
        metadata: t.optional(t.record(t.string(), t.any())),
      }),
      response: issues.schema,
    },
    handler: async ({ body }) => {
      this.log.info("Creating issue", {
        title: body.title,
        creatorType: body.creatorType,
      });

      const issue = await this.issues.create({
        ...body,
        status: "open",
      });

      this.log.info("Issue created", { id: issue.id, title: issue.title });

      return issue;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Update Issue
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update an issue.
   * PATCH /admin/issues/:id
   */
  updateIssue = $action({
    method: "PATCH",
    path: "/admin/issues/:id",
    secure: false,
    description: "Update an issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        title: t.optional(t.text({ minLength: 1, maxLength: 500 })),
        description: t.optional(t.text({ maxLength: 10000 })),
        priority: t.optional(t.enum(["low", "medium", "high", "urgent"])),
        tags: t.optional(t.array(t.text())),
        category: t.optional(t.text()),
        customerId: t.optional(t.uuid()),
        bookingId: t.optional(t.uuid()),
        metadata: t.optional(t.record(t.string(), t.any())),
      }),
      response: issues.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating issue", { id: params.id });

      const issue = await this.issues.updateById(params.id, body);

      this.log.info("Issue updated", { id: issue.id });

      return issue;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Status Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Assign an issue to an agent.
   * Transitions: OPEN → PENDING
   * POST /admin/issues/:id/assign
   */
  assignIssue = $action({
    method: "POST",
    path: "/admin/issues/:id/assign",
    secure: false,
    description: "Assign issue to an agent",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        agentId: t.uuid(),
      }),
      response: issues.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Assigning issue", {
        id: params.id,
        agentId: body.agentId,
      });

      const issue = await this.issues.findById(params.id);

      if (issue.status !== "open") {
        throw new Error(
          `Cannot assign issue in status: ${issue.status}. Issue must be OPEN.`,
        );
      }

      const updatedIssue = await this.issues.updateById(params.id, {
        assignedAgentId: body.agentId,
        assignedAt: new Date().toISOString(),
        status: "pending",
      });

      // Add system message for assignment
      await this.addSystemMessage(
        params.id,
        "Issue assigned to agent",
        "assignment",
        {
          previousStatus: issue.status,
          newStatus: "pending",
          newAgentId: body.agentId,
        },
      );

      this.log.info("Issue assigned", {
        id: updatedIssue.id,
        agentId: body.agentId,
        status: updatedIssue.status,
      });

      return updatedIssue;
    },
  });

  /**
   * Accept (resolve) an issue.
   * Transitions: PENDING → ACCEPTED
   * POST /admin/issues/:id/accept
   */
  acceptIssue = $action({
    method: "POST",
    path: "/admin/issues/:id/accept",
    secure: false,
    description: "Accept (resolve) an issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        resolutionNotes: t.optional(t.text({ maxLength: 5000 })),
      }),
      response: issues.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Accepting issue", { id: params.id });

      const issue = await this.issues.findById(params.id);

      if (issue.status !== "pending") {
        throw new Error(
          `Cannot accept issue in status: ${issue.status}. Issue must be PENDING.`,
        );
      }

      const updatedIssue = await this.issues.updateById(params.id, {
        status: "accepted",
        resolvedAt: new Date().toISOString(),
        resolutionNotes: body.resolutionNotes,
      });

      // Add system message for acceptance
      await this.addSystemMessage(
        params.id,
        body.resolutionNotes || "Issue resolved",
        "status_change",
        { previousStatus: issue.status, newStatus: "accepted" },
      );

      this.log.info("Issue accepted", { id: updatedIssue.id });

      return updatedIssue;
    },
  });

  /**
   * Reject an issue.
   * Transitions: PENDING → REJECTED
   * POST /admin/issues/:id/reject
   */
  rejectIssue = $action({
    method: "POST",
    path: "/admin/issues/:id/reject",
    secure: false,
    description: "Reject an issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        resolutionNotes: t.optional(t.text({ maxLength: 5000 })),
      }),
      response: issues.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Rejecting issue", { id: params.id });

      const issue = await this.issues.findById(params.id);

      if (issue.status !== "pending") {
        throw new Error(
          `Cannot reject issue in status: ${issue.status}. Issue must be PENDING.`,
        );
      }

      const updatedIssue = await this.issues.updateById(params.id, {
        status: "rejected",
        resolvedAt: new Date().toISOString(),
        resolutionNotes: body.resolutionNotes,
      });

      // Add system message for rejection
      await this.addSystemMessage(
        params.id,
        body.resolutionNotes || "Issue rejected",
        "status_change",
        { previousStatus: issue.status, newStatus: "rejected" },
      );

      this.log.info("Issue rejected", { id: updatedIssue.id });

      return updatedIssue;
    },
  });

  /**
   * Cancel an issue.
   * Transitions: ANY → CANCELLED
   * POST /admin/issues/:id/cancel
   */
  cancelIssue = $action({
    method: "POST",
    path: "/admin/issues/:id/cancel",
    secure: false,
    description: "Cancel an issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        reason: t.optional(t.text({ maxLength: 1000 })),
      }),
      response: issues.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Cancelling issue", { id: params.id });

      const issue = await this.issues.findById(params.id);

      if (issue.status === "cancelled" || issue.status === "archived") {
        throw new Error(`Cannot cancel issue in status: ${issue.status}`);
      }

      const updatedIssue = await this.issues.updateById(params.id, {
        status: "cancelled",
        resolutionNotes: body.reason
          ? `Cancelled: ${body.reason}`
          : issue.resolutionNotes,
      });

      // Add system message for cancellation
      await this.addSystemMessage(
        params.id,
        body.reason || "Issue cancelled",
        "status_change",
        { previousStatus: issue.status, newStatus: "cancelled" },
      );

      this.log.info("Issue cancelled", { id: updatedIssue.id });

      return updatedIssue;
    },
  });

  /**
   * Reopen an issue.
   * Transitions: CANCELLED/REJECTED → OPEN
   * POST /admin/issues/:id/reopen
   */
  reopenIssue = $action({
    method: "POST",
    path: "/admin/issues/:id/reopen",
    secure: false,
    description: "Reopen a closed issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: issues.schema,
    },
    handler: async ({ params }) => {
      this.log.info("Reopening issue", { id: params.id });

      const issue = await this.issues.findById(params.id);

      if (issue.status !== "cancelled" && issue.status !== "rejected") {
        throw new Error(
          `Cannot reopen issue in status: ${issue.status}. Issue must be CANCELLED or REJECTED.`,
        );
      }

      const updatedIssue = await this.issues.updateById(params.id, {
        status: "open",
        assignedAgentId: undefined,
        assignedAt: undefined,
        resolvedAt: undefined,
      });

      // Add system message for reopening
      await this.addSystemMessage(
        params.id,
        "Issue reopened",
        "status_change",
        { previousStatus: issue.status, newStatus: "open" },
      );

      this.log.info("Issue reopened", { id: updatedIssue.id });

      return updatedIssue;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Statistics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get issue statistics summary.
   * GET /admin/issues/stats
   */
  getIssueStats = $action({
    path: "/admin/issues/stats",
    secure: false,
    description: "Get issue statistics summary",
    schema: {
      response: t.object({
        totalIssues: t.integer(),
        openIssues: t.integer(),
        pendingIssues: t.integer(),
        acceptedIssues: t.integer(),
        rejectedIssues: t.integer(),
        cancelledIssues: t.integer(),
        archivedIssues: t.integer(),
        byPriority: t.array(
          t.object({
            priority: t.text(),
            count: t.integer(),
          }),
        ),
        byCategory: t.array(
          t.object({
            category: t.text(),
            count: t.integer(),
          }),
        ),
      }),
    },
    handler: async () => {
      const allIssues = await this.issues.findMany({});

      const stats = {
        totalIssues: allIssues.length,
        openIssues: allIssues.filter((i) => i.status === "open").length,
        pendingIssues: allIssues.filter((i) => i.status === "pending").length,
        acceptedIssues: allIssues.filter((i) => i.status === "accepted").length,
        rejectedIssues: allIssues.filter((i) => i.status === "rejected").length,
        cancelledIssues: allIssues.filter((i) => i.status === "cancelled")
          .length,
        archivedIssues: allIssues.filter((i) => i.status === "archived").length,
        byPriority: [] as { priority: string; count: number }[],
        byCategory: [] as { category: string; count: number }[],
      };

      // Group by priority
      const priorityCounts = new Map<string, number>();
      for (const issue of allIssues) {
        const priority = issue.priority ?? "medium";
        priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1);
      }
      stats.byPriority = Array.from(priorityCounts.entries()).map(
        ([priority, count]) => ({ priority, count }),
      );

      // Group by category
      const categoryCounts = new Map<string, number>();
      for (const issue of allIssues) {
        const category = issue.category ?? "Uncategorized";
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }
      stats.byCategory = Array.from(categoryCounts.entries()).map(
        ([category, count]) => ({ category, count }),
      );

      return stats;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Bulk Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Archive resolved issues older than X days.
   * POST /admin/issues/archive
   */
  archiveOldIssues = $action({
    method: "POST",
    path: "/admin/issues/archive",
    secure: false,
    description: "Archive resolved issues older than specified days",
    schema: {
      body: t.object({
        olderThanDays: t.integer({ minimum: 1, default: 30 }),
      }),
      response: t.object({
        archivedCount: t.integer(),
      }),
    },
    handler: async ({ body }) => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - body.olderThanDays);
      const cutoffIso = cutoffDate.toISOString();

      this.log.info("Archiving old issues", {
        olderThanDays: body.olderThanDays,
        cutoffDate: cutoffIso,
      });

      // Find resolved issues older than cutoff
      const issuesToArchive = await this.issues.findMany({
        where: {
          or: [{ status: { eq: "accepted" } }, { status: { eq: "rejected" } }],
          resolvedAt: { lt: cutoffIso },
        },
      });

      let archivedCount = 0;
      for (const issue of issuesToArchive) {
        await this.issues.updateById(issue.id, {
          status: "archived",
          archivedAt: new Date().toISOString(),
        });
        archivedCount++;
      }

      this.log.info("Issues archived", { archivedCount });

      return { archivedCount };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Messages (Chat)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get messages for an issue (timeline).
   * GET /admin/issues/:id/messages
   */
  getIssueMessages = $action({
    path: "/admin/issues/:id/messages",
    secure: false,
    description: "Get messages for an issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
      }),
      response: t.page(issueMessages.schema),
    },
    handler: async ({ params, query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 50;

      const result = await this.messages.paginate(
        { page, size },
        {
          where: {
            issueId: { eq: params.id },
            isDeleted: { eq: false },
          },
          orderBy: [{ column: "createdAt", direction: "asc" }],
        },
      );

      return result as Page<IssueMessage>;
    },
  });

  /**
   * Add a message to an issue.
   * POST /admin/issues/:id/messages
   */
  addIssueMessage = $action({
    method: "POST",
    path: "/admin/issues/:id/messages",
    secure: false,
    description: "Add a message to an issue",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        content: t.text({ minLength: 1, maxLength: 10000 }),
        messageType: t.optional(t.enum(["comment", "note"])),
        authorType: t.enum(["customer", "agent"]),
        authorId: t.optional(t.uuid()),
        authorName: t.optional(t.text()),
      }),
      response: issueMessages.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Adding message to issue", {
        issueId: params.id,
        authorType: body.authorType,
      });

      const message = await this.messages.create({
        issueId: params.id,
        content: body.content,
        messageType: body.messageType ?? "comment",
        authorType: body.authorType,
        authorId: body.authorId,
        authorName: body.authorName,
      });

      this.log.info("Message added", { id: message.id, issueId: params.id });

      return message;
    },
  });

  /**
   * Update a message.
   * PATCH /admin/issues/:issueId/messages/:messageId
   */
  updateIssueMessage = $action({
    method: "PATCH",
    path: "/admin/issues/:issueId/messages/:messageId",
    secure: false,
    description: "Update a message",
    schema: {
      params: t.object({
        issueId: t.uuid(),
        messageId: t.uuid(),
      }),
      body: t.object({
        content: t.text({ minLength: 1, maxLength: 10000 }),
      }),
      response: issueMessages.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating message", { messageId: params.messageId });

      const message = await this.messages.updateById(params.messageId, {
        content: body.content,
        editedAt: new Date().toISOString(),
      });

      this.log.info("Message updated", { id: message.id });

      return message;
    },
  });

  /**
   * Delete a message (soft delete).
   * DELETE /admin/issues/:issueId/messages/:messageId
   */
  deleteIssueMessage = $action({
    method: "DELETE",
    path: "/admin/issues/:issueId/messages/:messageId",
    secure: false,
    description: "Delete a message",
    schema: {
      params: t.object({
        issueId: t.uuid(),
        messageId: t.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      this.log.info("Deleting message", { messageId: params.messageId });

      await this.messages.updateById(params.messageId, {
        isDeleted: true,
      });

      this.log.info("Message deleted", { messageId: params.messageId });

      return { ok: true };
    },
  });

  /**
   * Add a system event message (internal use).
   */
  protected async addSystemMessage(
    issueId: string,
    content: string,
    messageType: "system" | "status_change" | "assignment",
    eventData?: {
      previousStatus?: string;
      newStatus?: string;
      previousAgentId?: string;
      newAgentId?: string;
      newAgentName?: string;
    },
  ) {
    await this.messages.create({
      issueId,
      content,
      messageType,
      authorType: "system",
      eventData,
    });
  }
}
