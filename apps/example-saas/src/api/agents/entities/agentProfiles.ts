import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

/**
 * Agent status - active agents can log in and work.
 */
export type AgentStatus = "active" | "inactive" | "suspended";

/**
 * Agent profiles - business data for SaaS employees (agents).
 *
 * This is separate from the auth user table. The userId links to the
 * user record in the shared auth tables (users table with realmName="agent").
 */
export const agentProfiles = $entity({
  name: "agent_profiles",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Link to user account in agent realm
    userId: t.uuid(),

    // Employee information
    employeeId: t.optional(t.text()), // Internal employee ID (e.g., "EMP-001")
    department: t.optional(t.text()), // e.g., "Customer Support", "Operations"
    jobTitle: t.optional(t.text()), // e.g., "Senior Support Agent"
    managerId: t.optional(t.uuid()), // Links to another agent profile

    // Contact info (may differ from login email)
    workEmail: t.optional(t.email()),
    workPhone: t.optional(t.text()),
    extension: t.optional(t.text()), // Phone extension

    // Work schedule
    timezone: t.optional(t.text()), // e.g., "Europe/Paris"
    workingHours: t.optional(
      t.object({
        start: t.text(), // e.g., "09:00"
        end: t.text(), // e.g., "18:00"
      }),
    ),
    workingDays: t.optional(t.array(t.integer())), // 0=Sunday, 1=Monday, etc.

    // Status
    status: pg.default(pg.enum(["active", "inactive", "suspended"]), "active"),
    hiredAt: t.optional(t.date()),
    terminatedAt: t.optional(t.date()),

    // Skills and capabilities
    skills: t.optional(t.array(t.text())), // e.g., ["refunds", "complaints", "vip"]
    languages: t.optional(t.array(t.text())), // ISO 639-1 codes, e.g., ["en", "fr"]

    // Performance metrics (denormalized for quick access)
    totalTicketsHandled: pg.default(t.integer(), 0),
    avgResolutionTimeMinutes: t.optional(t.number()),
    customerSatisfactionScore: t.optional(t.number()), // e.g., 4.5 out of 5

    // Notes
    notes: t.optional(t.text()), // Internal admin notes
  }),
  indexes: [
    { columns: ["userId"], unique: true },
    { columns: ["employeeId"], unique: true },
    { columns: ["status"] },
    { columns: ["department"] },
    { columns: ["managerId"] },
  ],
});

export type AgentProfile = Static<typeof agentProfiles.schema>;
