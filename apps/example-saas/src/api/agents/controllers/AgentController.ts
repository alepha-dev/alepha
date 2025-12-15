import { $inject, type Page, t } from "alepha";
import { UserRealmProvider, UserService } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { CryptoProvider } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { type AgentProfile, agentProfiles } from "../entities/agentProfiles.ts";

const AGENT_REALM = "agent";

/**
 * Controller for managing agents (SaaS employees).
 *
 * Agents are created by admins (no self-registration).
 * Each agent has a user account in the "agent" realm and a profile here.
 */
export class AgentController {
  protected readonly log = $logger();
  protected readonly agentProfiles = $repository(agentProfiles);
  protected readonly userService = $inject(UserService);
  protected readonly userRealmProvider = $inject(UserRealmProvider);
  protected readonly cryptoProvider = $inject(CryptoProvider);

  // ─────────────────────────────────────────────────────────────────────────────
  // List & Search
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all agents with pagination and filtering.
   * GET /admin/agents
   */
  findAgents = $action({
    path: "/admin/agents",
    secure: false,
    description: "Find all agents with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        status: t.optional(t.enum(["active", "inactive", "suspended"])),
        department: t.optional(t.text()),
      }),
      response: t.page(agentProfiles.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      const where: Record<string, unknown> = {};

      if (query.status) {
        where.status = { eq: query.status };
      }

      if (query.department) {
        where.department = { eq: query.department };
      }

      if (query.query) {
        where.or = [
          { employeeId: { ilike: `%${query.query}%` } },
          { workEmail: { ilike: `%${query.query}%` } },
          { jobTitle: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.agentProfiles.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: [
            { column: "status", direction: "asc" },
            { column: "createdAt", direction: "desc" },
          ],
        },
      );

      return result as Page<AgentProfile>;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Get Single Agent
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a single agent by ID.
   * GET /admin/agents/:id
   */
  getAgent = $action({
    path: "/admin/agents/:id",
    secure: false,
    description: "Get an agent by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: agentProfiles.schema,
    },
    handler: async ({ params }) => {
      return await this.agentProfiles.findById(params.id);
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Create Agent
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new agent.
   * Creates user account in "agent" realm and links agent profile.
   * POST /admin/agents
   */
  createAgent = $action({
    method: "POST",
    path: "/admin/agents",
    secure: false,
    description: "Create a new agent with user account",
    schema: {
      body: t.object({
        // User account fields
        email: t.email(),
        username: t.text(),
        firstName: t.text(),
        lastName: t.text(),
        password: t.text({ minLength: 8 }),
        role: t.optional(
          t.enum(["admin", "supervisor", "support", "operations"]),
        ),

        // Agent profile fields
        employeeId: t.optional(t.text()),
        department: t.optional(t.text()),
        jobTitle: t.optional(t.text()),
        managerId: t.optional(t.uuid()),
        workEmail: t.optional(t.email()),
        workPhone: t.optional(t.text()),
        extension: t.optional(t.text()),
        timezone: t.optional(t.text()),
        hiredAt: t.optional(t.date()),
        skills: t.optional(t.array(t.text())),
        languages: t.optional(t.array(t.text())),
        notes: t.optional(t.text()),
      }),
      response: agentProfiles.schema,
    },
    handler: async ({ body }) => {
      const {
        email,
        username,
        firstName,
        lastName,
        password,
        role,
        ...profileData
      } = body;

      this.log.info("Creating agent user", { email, username });

      // Create user in agent realm
      const user = await this.userService.createUser(
        {
          email,
          username,
          firstName,
          lastName,
          roles: role ? [role] : ["support"], // Default role is support
          enabled: true,
        },
        AGENT_REALM,
      );

      this.log.info("Agent user created", { userId: user.id, username });

      // Hash password and create credentials identity
      const passwordHash = await this.cryptoProvider.hashPassword(password);
      const identityRepository =
        this.userRealmProvider.identityRepository(AGENT_REALM);
      await identityRepository.create({
        userId: user.id,
        provider: "credentials",
        password: passwordHash,
      });

      this.log.info("Agent credentials created", { userId: user.id });

      // Create agent profile linked to user
      const agent = await this.agentProfiles.create({
        userId: user.id,
        workEmail: profileData.workEmail ?? email,
        status: "active",
        ...profileData,
      });

      this.log.info("Agent profile created", {
        id: agent.id,
        userId: user.id,
        employeeId: agent.employeeId,
      });

      return agent;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Update Agent
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update an agent profile.
   * PATCH /admin/agents/:id
   */
  updateAgent = $action({
    method: "PATCH",
    path: "/admin/agents/:id",
    secure: false,
    description: "Update an agent profile",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        employeeId: t.optional(t.text()),
        department: t.optional(t.text()),
        jobTitle: t.optional(t.text()),
        managerId: t.optional(t.uuid()),
        workEmail: t.optional(t.email()),
        workPhone: t.optional(t.text()),
        extension: t.optional(t.text()),
        timezone: t.optional(t.text()),
        workingHours: t.optional(
          t.object({
            start: t.text(),
            end: t.text(),
          }),
        ),
        workingDays: t.optional(t.array(t.integer())),
        status: t.optional(t.enum(["active", "inactive", "suspended"])),
        hiredAt: t.optional(t.date()),
        terminatedAt: t.optional(t.date()),
        skills: t.optional(t.array(t.text())),
        languages: t.optional(t.array(t.text())),
        notes: t.optional(t.text()),
      }),
      response: agentProfiles.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating agent profile", { id: params.id });

      const agent = await this.agentProfiles.updateById(params.id, body);

      this.log.info("Agent profile updated", { id: agent.id });

      return agent;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Status Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Suspend an agent.
   * POST /admin/agents/:id/suspend
   */
  suspendAgent = $action({
    method: "POST",
    path: "/admin/agents/:id/suspend",
    secure: false,
    description: "Suspend an agent",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        reason: t.optional(t.text()),
      }),
      response: agentProfiles.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Suspending agent", { id: params.id, reason: body.reason });

      const agent = await this.agentProfiles.findById(params.id);

      // Disable user account
      await this.userService.updateUser(agent.userId, { enabled: false });

      // Update agent status
      const updatedAgent = await this.agentProfiles.updateById(params.id, {
        status: "suspended",
        notes: body.reason
          ? `${agent.notes ? `${agent.notes}\n` : ""}Suspended: ${body.reason}`
          : agent.notes,
      });

      this.log.info("Agent suspended", { id: updatedAgent.id });

      return updatedAgent;
    },
  });

  /**
   * Activate an agent (re-enable after suspension or inactivity).
   * POST /admin/agents/:id/activate
   */
  activateAgent = $action({
    method: "POST",
    path: "/admin/agents/:id/activate",
    secure: false,
    description: "Activate an agent",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: agentProfiles.schema,
    },
    handler: async ({ params }) => {
      this.log.info("Activating agent", { id: params.id });

      const agent = await this.agentProfiles.findById(params.id);

      // Enable user account
      await this.userService.updateUser(agent.userId, { enabled: true });

      // Update agent status
      const updatedAgent = await this.agentProfiles.updateById(params.id, {
        status: "active",
      });

      this.log.info("Agent activated", { id: updatedAgent.id });

      return updatedAgent;
    },
  });

  /**
   * Terminate an agent (end employment).
   * POST /admin/agents/:id/terminate
   */
  terminateAgent = $action({
    method: "POST",
    path: "/admin/agents/:id/terminate",
    secure: false,
    description: "Terminate an agent",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        terminationDate: t.optional(t.date()),
        reason: t.optional(t.text()),
      }),
      response: agentProfiles.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Terminating agent", { id: params.id });

      const agent = await this.agentProfiles.findById(params.id);

      // Disable user account
      await this.userService.updateUser(agent.userId, { enabled: false });

      // Update agent status
      const updatedAgent = await this.agentProfiles.updateById(params.id, {
        status: "inactive",
        terminatedAt:
          body.terminationDate ?? new Date().toISOString().split("T")[0],
        notes: body.reason
          ? `${agent.notes ? `${agent.notes}\n` : ""}Terminated: ${body.reason}`
          : agent.notes,
      });

      this.log.info("Agent terminated", { id: updatedAgent.id });

      return updatedAgent;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Statistics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get agent statistics summary.
   * GET /admin/agents/stats
   */
  getAgentStats = $action({
    path: "/admin/agents/stats",
    secure: false,
    description: "Get agent statistics summary",
    schema: {
      response: t.object({
        totalAgents: t.integer(),
        activeAgents: t.integer(),
        inactiveAgents: t.integer(),
        suspendedAgents: t.integer(),
        byDepartment: t.array(
          t.object({
            department: t.text(),
            count: t.integer(),
          }),
        ),
      }),
    },
    handler: async () => {
      const allAgents = await this.agentProfiles.findMany({});

      const stats = {
        totalAgents: allAgents.length,
        activeAgents: allAgents.filter((a) => a.status === "active").length,
        inactiveAgents: allAgents.filter((a) => a.status === "inactive").length,
        suspendedAgents: allAgents.filter((a) => a.status === "suspended")
          .length,
        byDepartment: [] as { department: string; count: number }[],
      };

      // Group by department
      const departmentCounts = new Map<string, number>();
      for (const agent of allAgents) {
        const dept = agent.department ?? "Unassigned";
        departmentCounts.set(dept, (departmentCounts.get(dept) ?? 0) + 1);
      }
      stats.byDepartment = Array.from(departmentCounts.entries()).map(
        ([department, count]) => ({ department, count }),
      );

      return stats;
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Password Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Reset an agent's password.
   * POST /admin/agents/:id/reset-password
   */
  resetAgentPassword = $action({
    method: "POST",
    path: "/admin/agents/:id/reset-password",
    secure: false,
    description: "Reset an agent's password",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        newPassword: t.text({ minLength: 8 }),
      }),
      response: okSchema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Resetting agent password", { id: params.id });

      const agent = await this.agentProfiles.findById(params.id);

      // Find credentials identity
      const identityRepository =
        this.userRealmProvider.identityRepository(AGENT_REALM);
      const sessionRepository =
        this.userRealmProvider.sessionRepository(AGENT_REALM);

      const identity = await identityRepository.findOne({
        where: {
          userId: { eq: agent.userId },
          provider: { eq: "credentials" },
        },
      });

      // Hash and update password
      const passwordHash = await this.cryptoProvider.hashPassword(
        body.newPassword,
      );
      await identityRepository.updateById(identity.id, {
        password: passwordHash,
      });

      // Invalidate all sessions for this user
      await sessionRepository.deleteMany({
        userId: { eq: agent.userId },
      });

      this.log.info("Agent password reset", { id: params.id });

      return { ok: true };
    },
  });
}
