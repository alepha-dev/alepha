import { $module } from "alepha";
import {
  AlephaApiAnalyticsAdmin,
  AlephaApiAnalyticsRollup,
} from "alepha/api/analytics";
import { AuditService } from "alepha/api/audits";
import { filesOptions } from "alepha/api/files";
import { AlephaApiJobsQueue } from "alepha/api/jobs";
import {
  AlephaApiOrganizations,
  organizationConfigAtom,
  OrganizationPolicyProvider,
} from "alepha/api/organizations";

import { AdminMcpController } from "./controllers/AdminMcpController.ts";
import { AdminProjectController } from "./controllers/AdminProjectController.ts";
import { DashboardController } from "./controllers/DashboardController.ts";
import { HomeController } from "./controllers/HomeController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { NotificationPreferenceController } from "./controllers/NotificationPreferenceController.ts";
import { ProjectCapabilityController } from "./controllers/ProjectCapabilityController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectDashboardController } from "./controllers/ProjectDashboardController.ts";
import { ProjectPromptController } from "./controllers/ProjectPromptController.ts";
import { ProjectRankController } from "./controllers/ProjectRankController.ts";
import { ResourceFilingController } from "./controllers/ResourceFilingController.ts";
import { SearchController } from "./controllers/SearchController.ts";
import { OrganizationHooks } from "./hooks/OrganizationHooks.ts";
import { UserDeletionHook } from "./hooks/UserDeletionHook.ts";
import { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
import { LoreInboxNotifications } from "./notifications/LoreInboxNotifications.ts";
import { NotificationHtmlEscaper } from "./notifications/NotificationHtmlEscaper.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
import { LoreInboxRecipientProvider } from "./providers/LoreInboxRecipientProvider.ts";
import { LoreNotificationPreferences } from "./providers/LoreNotificationPreferences.ts";
import { LoreOrganizationPolicyProvider } from "./providers/LoreOrganizationPolicyProvider.ts";
import { CapabilityRegistry } from "./schemas/CapabilityRegistry.ts";
import { LorePermissions } from "./security/LorePermissions.ts";
import { ProjectRankPresets } from "./security/ProjectRankPresets.ts";
import { DashboardCardService } from "./services/DashboardCardService.ts";
import { DashboardMetricRegistry } from "./services/DashboardMetricRegistry.ts";
import { DashboardScopeService } from "./services/DashboardScopeService.ts";
import { LoreAudits } from "./services/LoreAudits.ts";
import { LoreAuditService } from "./services/LoreAuditService.ts";
import { ProjectDashboardCardService } from "./services/ProjectDashboardCardService.ts";
import { ProjectLimits } from "./services/ProjectLimits.ts";
import { ProjectRoster } from "./services/ProjectRoster.ts";
import { ProjectSecurityService } from "./services/ProjectSecurityService.ts";
import { ResourceLinkService } from "./services/ResourceLinkService.ts";

/**
 * The server half of `@lore/core`, the glue: projects, capabilities, ranks and permissions, notifications, audits, the resource registry and its link graph, search, the dashboard, reports, agent prompts and the web shell.
 *
 * It imports no other `@lore` package: work, knowledge and deploy depend on it, and it never depends on them (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreCoreApi = $module({
  name: "lore.core.api",
  // `$analytics()` (used by `ProjectAnalytics` and `DeployAnalytics`) auto-wires `AlephaApiAnalytics`
  // itself the moment a dataset is injected — the same module-tagging
  // mechanism `$repository` uses for `AlephaOrm`. The hourly retention sweep
  // does not: `AnalyticsRollupJobs` lives in the separate `AlephaApiAnalyticsRollup`
  // module specifically so declaring a dataset never forces a database
  // connection onto an app that has none. Both `sigil_views` and
  // `sigil_vitals` declare `retention.hot`, so this import is required, not
  // optional — without it the sweep never runs and the raw tables grow
  // forever with no error (see `AnalyticsRetentionGuard`'s boot warning).
  // `AlephaApiAnalyticsAdmin` is the opt-in admin query surface behind
  // `admin:analytics:read` — it feeds the /admin/analytics page.
  //
  // `AlephaApiOrganizations` owns the membership, rank, and invitation
  // lifecycle. Lore supplies the project-specific policy and notifications.
  imports: [
    AlephaApiAnalyticsRollup,
    AlephaApiAnalyticsAdmin,
    // ⚠️ **Without this every `$job` runs inside `executionCtx.waitUntil`,
    // which Cloudflare cuts off about 30 seconds after the response.** That
    // is not a slow path, it is a hard ceiling, and `deploys.run` is the
    // job that lives past it: a `docs` deploy on 2026-09-09 logged
    // `Uploaded 405 assets` at exactly 30s, the isolate was cancelled
    // mid-upload, and because the run's own timer died with it the row read
    // `running` until the sweep, while `lore apps deploy` polled it for the
    // full ten minutes and CI reported nothing but a long step.
    //
    // A queue consumer gets 15 minutes of wall clock instead, which is the
    // only surface Cloudflare offers that a deploy of somebody else's site
    // fits inside. It also gives retries a real delay, since the transport
    // can hold a delayed message rather than waiting for the outbox sweep.
    //
    // ⚠️ CPU is a SEPARATE budget and the queue does not raise it. That is
    // `limits.cpu_ms` in `alepha.config.ts`, and it stays.
    //
    // On Node (the self-hosted image, `alepha dev`, tests) this resolves to
    // `MemoryQueueProvider`, so dispatch takes an in-process hop instead of
    // running in front of the caller. Durability is unchanged either way:
    // the outbox row is the guarantee and the reconciliation sweep is the
    // backstop.
    AlephaApiJobsQueue,
    // Registering this module installs the grants provider used by
    // `$ownsOrganization`, before the controllers whose gates depend on it.
    AlephaApiOrganizations,
  ],
  services: [
    // Declares the `$realm`. Nothing injects it — it must be listed here
    // explicitly or the realm (and every permission) is never registered.
    AppSecurityProvider,
    // Declares every `$permission`. Nothing injects it either: the strings
    // reach the registry through `$secure()` anyway, and what this class adds
    // is their LABELS and their group order - which the rank matrix renders
    // from. Unlisted, the matrix would show raw `group:name` strings in
    // whatever order the gates happened to run.
    LorePermissions,
    // Declares the $audit types. Nothing but the controllers inject it, and
    // they inject it lazily - listed here so the types are registered at
    // boot and the admin filter offers them before any row exists.
    LoreAudits,
    ProjectSecurityService,
    CapabilityRegistry,
    // Substituted for the framework's `FileAccessProvider` in
    // `main.server.ts`. Listed here only so DI scanning sees the class.
    LoreFileAccessProvider,
    ResourceLinkService,
    // Declares the `$invitationResource` for `resourceType: "project"`.
    // Nothing injects it, so like `AppSecurityProvider` it has to be listed
    // or the resolver is never registered and every invitation 404s.
    // Declares the `$rankResource` for `type: "project"`, for the same
    // reason: unlisted, the ranks module knows about no scope at all and
    // every `requires` allows.
    ProjectRankPresets,
    UserDeletionHook,
    OrganizationHooks,
    InvitationNotifications,
    // The inbox half: two templates, and the one HTML escaper the four
    // notification classes share.
    LoreInboxNotifications,
    NotificationHtmlEscaper,
    // Who is in a project, as one read, for everything that writes to
    // people. One question, not two.
    ProjectRoster,
    // Substituted for the framework's `NotificationInboxRecipientProvider`
    // in `main.server.ts`. Listed here only so DI scanning sees the class,
    // the same arrangement `LoreFileAccessProvider` has.
    LoreInboxRecipientProvider,
    // Substituted for the framework's `NotificationPreferenceProvider` in
    // `main.server.ts`, same arrangement.
    LoreNotificationPreferences,
    NotificationPreferenceController,
    ProjectLimits,
    // The dashboard: the membership gate every card scope goes through, and
    // card storage. The declarative registry (`DashboardMetricCatalog`) is
    // browser-safe and constructed by whatever injects it; each module
    // registers its descriptors from both its api and its web module.
    DashboardScopeService,
    DashboardCardService,
    // The project board's own storage. A second table rather than a branch
    // inside the one above: the configuration belongs to the project, so
    // every query here names a project and none of them names a user.
    ProjectDashboardCardService,
    DashboardMetricRegistry,
    ProjectController,
    // The landing page's own reads: the momentum bars and the activity panel.
    // Off `ProjectController` because neither is about one project, and off
    // `getHomeOverview` because that endpoint fills an atom every page holds.
    HomeController,
    ProjectCapabilityController,
    ProjectRankController,
    ProjectPromptController,
    ResourceFilingController,
    InvitationController,
    AdminProjectController,
    // What the MCP surface is asked for, over time (#E65). Admin rather than
    // a project page: a tool call is not scoped to a project.
    AdminMcpController,
    SearchController,
    DashboardController,
    // The project board. A second controller rather than a branch inside the
    // one above: every path here hangs off `/projects/:projectId` and is
    // gated by `$ownsProject`, where home's hang off `/me` and cannot be.
    ProjectDashboardController,
  ],
  register: (alepha) => {
    // Registered before any module, so these substitutions land before the
    // first `$audit` user or organization policy reader is constructed.
    alepha.with({
      provide: OrganizationPolicyProvider,
      use: LoreOrganizationPolicyProvider,
    });
    alepha.with({ provide: AuditService, use: LoreAuditService });
    alepha.store.set(organizationConfigAtom, {
      ...alepha.store.get(organizationConfigAtom),
      memberPermissions: LorePermissions.MEMBER_DEFAULT,
      floor: LorePermissions.FLOOR,
      ownerOnly: LorePermissions.OWNER_ONLY,
    });
    alepha.store.set(filesOptions, {
      ...alepha.store.get(filesOptions),
      maxTotalSize: 10 * 1024,
      maxUserSize: 250,
    });
  },
});

// ---- re-exports, generated by the extraction (#E75) ----

export { AdminMcpController } from "./controllers/AdminMcpController.ts";
export { AdminProjectController } from "./controllers/AdminProjectController.ts";
export { DashboardController } from "./controllers/DashboardController.ts";
export { HomeController } from "./controllers/HomeController.ts";
export { InvitationController } from "./controllers/InvitationController.ts";
export { NotificationPreferenceController } from "./controllers/NotificationPreferenceController.ts";
export { ProjectCapabilityController } from "./controllers/ProjectCapabilityController.ts";
export { ProjectController } from "./controllers/ProjectController.ts";
export { ProjectDashboardController } from "./controllers/ProjectDashboardController.ts";
export { ProjectPromptController } from "./controllers/ProjectPromptController.ts";
export { ProjectRankController } from "./controllers/ProjectRankController.ts";
export { ResourceFilingController } from "./controllers/ResourceFilingController.ts";
export { SearchController } from "./controllers/SearchController.ts";
export { OrganizationHooks } from "./hooks/OrganizationHooks.ts";
export { UserDeletionHook } from "./hooks/UserDeletionHook.ts";
export { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
export { LoreInboxNotifications } from "./notifications/LoreInboxNotifications.ts";
export { NotificationHtmlEscaper } from "./notifications/NotificationHtmlEscaper.ts";
export { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
export { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
export { LoreInboxRecipientProvider } from "./providers/LoreInboxRecipientProvider.ts";
export { LoreNotificationPreferences } from "./providers/LoreNotificationPreferences.ts";
export { LoreOrganizationPolicyProvider } from "./providers/LoreOrganizationPolicyProvider.ts";
export { coreRelations } from "./relations/coreRelations.ts";
export {
  type ResourceCreateInput,
  type ResourceCreated,
  type ResourceDeletion,
  type ResourceDeletionHandler,
  type ResourceKind,
  type ResourceRef,
  ResourceRegistry,
  type ResourceSearchQuery,
  type ResourceSearchSource,
} from "./resources/ResourceRegistry.ts";
export { SearchPreview } from "./resources/SearchPreview.ts";
export { type RankableHit, orderSearchHits } from "./searchRanking.ts";
export {
  $ownsProject,
  type OwnsProjectOptions,
  type RequiredCapability,
} from "./security/$ownsProject.ts";
export { LoreOAuthScopes } from "./security/LoreOAuthScopes.ts";
export { LorePermissions } from "./security/LorePermissions.ts";
export { LoreRankBounds } from "./security/LoreRankBounds.ts";
export {
  type ProjectPermissionSet,
  ProjectPermissions,
} from "./security/ProjectPermissions.ts";
export {
  type PresetKey,
  type ProjectRankPreset,
  ProjectRankPresets,
} from "./security/ProjectRankPresets.ts";
export {
  type AssignedWorkProvider,
  AssignedWorkRegistry,
} from "./services/AssignedWorkRegistry.ts";
export { BestEffort } from "./services/BestEffort.ts";
export { BoundParameters } from "./services/BoundParameters.ts";
export {
  DashboardCardService,
  type DashboardSeed,
} from "./services/DashboardCardService.ts";
export { DashboardMetricRegistry } from "./services/DashboardMetricRegistry.ts";
export type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./services/DashboardMetricResolver.ts";
export {
  type DashboardScopeResolver,
  DashboardScopeService,
  type DashboardScopeSubject,
  type ResolvedDashboardScope,
} from "./services/DashboardScopeService.ts";
export {
  FileAccessRegistry,
  type FileAccessRule,
} from "./services/FileAccessRegistry.ts";
export { LoreAuditService } from "./services/LoreAuditService.ts";
export { LoreAudits } from "./services/LoreAudits.ts";
export { McpCallRates } from "./services/McpCallRates.ts";
export {
  type ProjectCountProvider,
  ProjectCountRegistry,
} from "./services/ProjectCountRegistry.ts";
export { ProjectDashboardCardService } from "./services/ProjectDashboardCardService.ts";
export {
  ProjectDeletionService,
  type ProjectDeletionStep,
} from "./services/ProjectDeletionService.ts";
export { ProjectLimits } from "./services/ProjectLimits.ts";
export { ProjectRecencyService } from "./services/ProjectRecencyService.ts";
export { ProjectResourceMapper } from "./services/ProjectResourceMapper.ts";
export {
  ProjectRoster,
  type ProjectRosterEntry,
} from "./services/ProjectRoster.ts";
export {
  type ProjectCapabilitySet,
  type ProjectGuard,
  ProjectSecurityService,
} from "./services/ProjectSecurityService.ts";
export {
  type LinkSource,
  type ParsedToken,
  ResourceLinkService,
} from "./services/ResourceLinkService.ts";
export { ProjectAnalytics } from "./entities/projectAnalytics.ts";
