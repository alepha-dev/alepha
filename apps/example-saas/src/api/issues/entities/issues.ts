import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

/**
 * Issue status workflow:
 * - OPEN: Initial state when created
 * - PENDING: When assigned to an agent and work begins
 * - ACCEPTED: Issue resolved successfully
 * - REJECTED: Issue rejected (invalid, duplicate, etc.)
 * - CANCELLED: Soft delete - can happen at any state
 * - ARCHIVED: Auto-archived after X days of ACCEPTED or REJECTED
 */
export type IssueStatus =
  | "open"
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "archived";

/**
 * Who created the issue:
 * - system: Automated/system-generated issue
 * - customer: Created by a customer
 * - agent: Created by an agent
 */
export type IssueCreatorType = "system" | "customer" | "agent";

/**
 * Issue priority levels
 */
export type IssuePriority = "low" | "medium" | "high" | "urgent";

/**
 * Issues - ticket system for customer support.
 *
 * Based on GitHub Issues model. Issues can only be resolved by agents.
 * Supports hierarchical issues (parent-child relationships).
 */
export const issues = $entity({
  name: "issues",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Issue content
    title: t.text({ minLength: 1, maxLength: 500 }),
    description: t.optional(t.text({ maxLength: 10000 })),

    // Status workflow
    status: pg.default(
      pg.enum([
        "open",
        "pending",
        "accepted",
        "rejected",
        "cancelled",
        "archived",
      ]),
      "open",
    ),

    // Creator information
    creatorType: pg.enum(["system", "customer", "agent"]),
    creatorId: t.optional(t.uuid()), // Null for system-created issues

    // Assignment
    assignedAgentId: t.optional(t.uuid()), // References agent_profiles.id
    assignedAt: t.optional(t.datetime()),

    // References
    customerId: t.optional(t.uuid()), // References customers.id
    bookingId: t.optional(t.uuid()), // References bookings.id
    parentIssueId: t.optional(t.uuid()), // Self-reference for hierarchy

    // Classification
    priority: pg.default(
      pg.enum(["low", "medium", "high", "urgent"]),
      "medium",
    ),
    tags: t.optional(t.array(t.text())),
    category: t.optional(t.text()), // e.g., "refund", "complaint", "inquiry"

    // Resolution
    resolvedAt: t.optional(t.datetime()),
    resolutionNotes: t.optional(t.text({ maxLength: 5000 })),

    // Archival
    archivedAt: t.optional(t.datetime()),

    // Metadata
    metadata: t.optional(t.record(t.string(), t.any())), // Flexible JSON for additional data
  }),
  indexes: [
    { columns: ["status"] },
    { columns: ["creatorType"] },
    { columns: ["creatorId"] },
    { columns: ["assignedAgentId"] },
    { columns: ["customerId"] },
    { columns: ["bookingId"] },
    { columns: ["parentIssueId"] },
    { columns: ["priority"] },
    { columns: ["createdAt"] },
  ],
});

export type Issue = Static<typeof issues.schema>;
