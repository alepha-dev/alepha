import { DiscordTransport, HttpDiscordTransport } from "@alepha/discord";
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
import { AlephaApiWebhooks } from "alepha/api/webhooks";
import { DatabaseProvider, DatabaseUrlParser } from "alepha/orm";
import { AlephaRateLimit } from "alepha/rate-limit";
import { AlephaWebSocket } from "alepha/websocket";

import { LoreDiscordNotificationChannel } from "./channels/LoreDiscordNotificationChannel.ts";
import { AdminHostController } from "./controllers/AdminHostController.ts";
import { AdminMcpController } from "./controllers/AdminMcpController.ts";
import { AdminProjectController } from "./controllers/AdminProjectController.ts";
import { AgentHostController } from "./controllers/AgentHostController.ts";
import { DashboardController } from "./controllers/DashboardController.ts";
import { HomeController } from "./controllers/HomeController.ts";
import { HostCommandController } from "./controllers/HostCommandController.ts";
import { HostCommandPullController } from "./controllers/HostCommandPullController.ts";
import { HostController } from "./controllers/HostController.ts";
import { HostEnrolController } from "./controllers/HostEnrolController.ts";
import { HostJobController } from "./controllers/HostJobController.ts";
import { HostSocketController } from "./controllers/HostSocketController.ts";
import { InvitationController } from "./controllers/InvitationController.ts";
import { NotificationPreferenceController } from "./controllers/NotificationPreferenceController.ts";
import { ProjectAnalyticsController } from "./controllers/ProjectAnalyticsController.ts";
import { ProjectCapabilityController } from "./controllers/ProjectCapabilityController.ts";
import { ProjectChannelController } from "./controllers/ProjectChannelController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { ProjectDashboardController } from "./controllers/ProjectDashboardController.ts";
import { ProjectEventController } from "./controllers/ProjectEventController.ts";
import { ProjectHostController } from "./controllers/ProjectHostController.ts";
import { ProjectMergeController } from "./controllers/ProjectMergeController.ts";
import { ProjectPromptController } from "./controllers/ProjectPromptController.ts";
import { ProjectRankController } from "./controllers/ProjectRankController.ts";
import { ProjectReportController } from "./controllers/ProjectReportController.ts";
import { ProjectThresholdController } from "./controllers/ProjectThresholdController.ts";
import { PromptController } from "./controllers/PromptController.ts";
import { QualityController } from "./controllers/QualityController.ts";
import { QualityReportsController } from "./controllers/QualityReportsController.ts";
import { ReportsSummaryController } from "./controllers/ReportsSummaryController.ts";
import { ResourceFilingController } from "./controllers/ResourceFilingController.ts";
import { SearchController } from "./controllers/SearchController.ts";
import { SubscriptionController } from "./controllers/SubscriptionController.ts";
import { UserDockController } from "./controllers/UserDockController.ts";
import { OrganizationHooks } from "./hooks/OrganizationHooks.ts";
import { UserDeletionHook } from "./hooks/UserDeletionHook.ts";
import { UserDockHooks } from "./hooks/UserDockHooks.ts";
import { AgentHostJobs } from "./jobs/AgentHostJobs.ts";
import { DefaultRankJobs } from "./jobs/DefaultRankJobs.ts";
import { HostCommandJobs } from "./jobs/HostCommandJobs.ts";
import { HostExpiryJobs } from "./jobs/HostExpiryJobs.ts";
import { HostJobJobs } from "./jobs/HostJobJobs.ts";
import { HostOfflineJobs } from "./jobs/HostOfflineJobs.ts";
import { HourlyJobs } from "./jobs/HourlyJobs.ts";
import { ProjectEventDeliveryJobs } from "./jobs/ProjectEventDeliveryJobs.ts";
import { ProjectEventJobs } from "./jobs/ProjectEventJobs.ts";
import { QualityJobs } from "./jobs/QualityJobs.ts";
import { InvitationNotifications } from "./notifications/InvitationNotifications.ts";
import { LoreInboxNotifications } from "./notifications/LoreInboxNotifications.ts";
import { NotificationHtmlEscaper } from "./notifications/NotificationHtmlEscaper.ts";
import { ProjectEventNotifications } from "./notifications/ProjectEventNotifications.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
import { LoreInboxRecipientProvider } from "./providers/LoreInboxRecipientProvider.ts";
import { LoreNotificationPreferences } from "./providers/LoreNotificationPreferences.ts";
import { LoreOrganizationPolicyProvider } from "./providers/LoreOrganizationPolicyProvider.ts";
import { LorePrimaryD1Provider } from "./providers/LorePrimaryD1Provider.ts";
import { CapabilityRegistry } from "./schemas/CapabilityRegistry.ts";
import { CoreDashboardMetrics } from "./schemas/CoreDashboardMetrics.ts";
import { QualityDashboardMetrics } from "./schemas/QualityDashboardMetrics.ts";
import { QualityNumericCatalog } from "./schemas/QualityNumericCatalog.ts";
import { LorePermissions } from "./security/LorePermissions.ts";
import { LoreRankBounds } from "./security/LoreRankBounds.ts";
import { ProjectRankPresets } from "./security/ProjectRankPresets.ts";
import { ActivityChannel } from "./services/ActivityChannel.ts";
import { ActivityFeedMetric } from "./services/ActivityFeedMetric.ts";
import { AgentHostService } from "./services/AgentHostService.ts";
import { AgentJobProjectEvents } from "./services/AgentJobProjectEvents.ts";
import { AgentJobs } from "./services/AgentJobs.ts";
import { AgentJobService } from "./services/AgentJobService.ts";
import { AgentRunPreamble } from "./services/AgentRunPreamble.ts";
import { BayReleaseTarget } from "./services/BayReleaseTarget.ts";
import { ChannelRoomRegistry } from "./services/ChannelRoomRegistry.ts";
import { CommitReferenceRegistry } from "./services/CommitReferenceRegistry.ts";
import { CoreBuckets } from "./services/CoreBuckets.ts";
import { CoreDashboard } from "./services/CoreDashboard.ts";
import { CoreProjectMerge } from "./services/CoreProjectMerge.ts";
import { CoverageThreshold } from "./services/CoverageThreshold.ts";
import { CredentialSealService } from "./services/CredentialSealService.ts";
import { DashboardAttentionRegistry } from "./services/DashboardAttentionRegistry.ts";
import { DashboardCardService } from "./services/DashboardCardService.ts";
import { DashboardMetricRegistry } from "./services/DashboardMetricRegistry.ts";
import { DashboardScopeService } from "./services/DashboardScopeService.ts";
import { DashboardSlotRegistry } from "./services/DashboardSlotRegistry.ts";
import { DeliveryChangeRegistry } from "./services/DeliveryChangeRegistry.ts";
import { HostAnchorHooks } from "./services/HostAnchorHooks.ts";
import { HostCommandHandlerRegistry } from "./services/HostCommandHandlerRegistry.ts";
import { HostCommandService } from "./services/HostCommandService.ts";
import { HostCommandTransport } from "./services/HostCommandTransport.ts";
import { HostHomeGuards } from "./services/HostHomeGuards.ts";
import { HostInventoryService } from "./services/HostInventoryService.ts";
import { HostJobs } from "./services/HostJobs.ts";
import { HostJobService } from "./services/HostJobService.ts";
import { HostProjectDeletion } from "./services/HostProjectDeletion.ts";
import { HostProjectEvents } from "./services/HostProjectEvents.ts";
import { HostProjectMerge } from "./services/HostProjectMerge.ts";
import { HostService } from "./services/HostService.ts";
import { HostsMetric } from "./services/HostsMetric.ts";
import { HostStatsService } from "./services/HostStatsService.ts";
import { HostTokenService } from "./services/HostTokenService.ts";
import { HostTypeRegistry } from "./services/HostTypeRegistry.ts";
import { HostUpgradeService } from "./services/HostUpgradeService.ts";
import { HostUsageRegistry } from "./services/HostUsageRegistry.ts";
import { HourlyChecks } from "./services/HourlyChecks.ts";
import { JobKeyService } from "./services/JobKeyService.ts";
import { LiveQuestRegistry } from "./services/LiveQuestRegistry.ts";
import { LoreAudits } from "./services/LoreAudits.ts";
import { LoreAuditService } from "./services/LoreAuditService.ts";
import { McpProjectScope } from "./services/McpProjectScope.ts";
import { MomentumMetric } from "./services/MomentumMetric.ts";
import { NeedsYouMetric } from "./services/NeedsYouMetric.ts";
import { NoteMetric } from "./services/NoteMetric.ts";
import { ProjectArchiveGuard } from "./services/ProjectArchiveGuard.ts";
import { ProjectChannelService } from "./services/ProjectChannelService.ts";
import { ProjectDashboardCardService } from "./services/ProjectDashboardCardService.ts";
import { ProjectDashboardPresets } from "./services/ProjectDashboardPresets.ts";
import { ProjectDashboardService } from "./services/ProjectDashboardService.ts";
import { ProjectEventCatalog } from "./services/ProjectEventCatalog.ts";
import { ProjectEventCatalogService } from "./services/ProjectEventCatalogService.ts";
import { ProjectEventDelivery } from "./services/ProjectEventDelivery.ts";
import { ProjectEventFilters } from "./services/ProjectEventFilters.ts";
import { ProjectEventReader } from "./services/ProjectEventReader.ts";
import { ProjectEvents } from "./services/ProjectEvents.ts";
import { ProjectLimits } from "./services/ProjectLimits.ts";
import { ProjectMomentumService } from "./services/ProjectMomentumService.ts";
import { ProjectQualityReportService } from "./services/ProjectQualityReportService.ts";
import { ProjectRecipients } from "./services/ProjectRecipients.ts";
import { ProjectReportRegistry } from "./services/ProjectReportRegistry.ts";
import { ProjectRoster } from "./services/ProjectRoster.ts";
import { ProjectSecurityService } from "./services/ProjectSecurityService.ts";
import { ProjectThresholds } from "./services/ProjectThresholds.ts";
import { PromptRegistry } from "./services/PromptRegistry.ts";
import { PromptReplyMail } from "./services/PromptReplyMail.ts";
import { PromptRunService } from "./services/PromptRunService.ts";
import { PromptService } from "./services/PromptService.ts";
import { PromptTriggers } from "./services/PromptTriggers.ts";
import { QualityNumericMetrics } from "./services/QualityNumericMetrics.ts";
import { QualityProjectEvents } from "./services/QualityProjectEvents.ts";
import { QualityProjectMerge } from "./services/QualityProjectMerge.ts";
import { QualityReportsSummary } from "./services/QualityReportsSummary.ts";
import { QualityService } from "./services/QualityService.ts";
import { QualityTrendMetric } from "./services/QualityTrendMetric.ts";
import { ReportsSummaryRegistry } from "./services/ReportsSummaryRegistry.ts";
import { ReportStatistics } from "./services/ReportStatistics.ts";
import { ResourceLinkService } from "./services/ResourceLinkService.ts";
import { SubscriptionService } from "./services/SubscriptionService.ts";
import { UserDockService } from "./services/UserDockService.ts";
import { WebSocketHostCommandTransport } from "./services/WebSocketHostCommandTransport.ts";

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
    // The hosts websocket (epic #20), core's since #E166: on Cloudflare the
    // build derives the Durable Object binding and its migration from the
    // `$websocket`, and the `workerd` export condition picks the Durable
    // Object provider over the Node one.
    AlephaWebSocket,
    // `$rateLimit` on `HostController.refreshHost`. Its counters are actors,
    // a Durable Object on workerd, which the Cloudflare build derives from the
    // registered graph, so the module is imported explicitly.
    AlephaRateLimit,
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
    // Webhook channels (#Q3900): a subscription calls an endpoint of the
    // framework's `$webhook`. Brings `webhook_endpoints`,
    // `webhook_deliveries`, its admin routes and its jobs; its purge runs on
    // `0 * * * *`, which the Worker already has.
    AlephaApiWebhooks,
  ],
  services: [
    // Every bucket of the package, at boot: an upload looks its bucket up
    // by name, and the controllers that use one stay pure (#Q3404).
    CoreBuckets,
    // The Bay release a host upgrade targets (#E152), core's since #E166.
    BayReleaseTarget,
    // The host project events (#Q4115): Core, so they exist with Ship off.
    HostProjectEvents,
    // A host's machine secret, minted and verified (#E166). Deliberately not
    // `SigilTokenService` with a different table, see its doc: the two
    // credentials are one grep apart and mean different things.
    HostTokenService,
    // A cloudflare token is pasted rather than minted, so it is sealed and
    // replayed rather than hashed and forgotten (#1631). Registered before
    // it has a writer: the sealer exists first, so no plaintext credential
    // is ever written even once. Listed by core since #E166, as its users
    // (HostService) are.
    CredentialSealService,
    // The seam the hosts websocket fills in. This default transport reaches
    // nothing, the correct behaviour of a Lore with no socket wired: commands
    // wait as `pending` for the machine's next connect. `main.server.ts`
    // substitutes the real one before this module registers.
    HostCommandTransport,
    // The host registries a module fills (#E166, #Q4098): what points at a
    // host, what its type does, and the command kinds core does not handle.
    HostUsageRegistry,
    HostTypeRegistry,
    HostCommandHandlerRegistry,
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
    ProjectArchiveGuard,
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
    // Keeps Viewer inside its allowlist while a project is open; nothing
    // injects it.
    // Registers its project deletion step; nothing injects it.
    // Registers core's project merge step (#Q2782); nothing injects it.
    CoreProjectMerge,
    ProjectChannelController,
    // Registers the configured channels as notification channel instances
    // (#Q3614); nothing else may inject it before an event is delivered.
    ProjectChannelService,
    // The `discord` notification channel: listed, not merely injected,
    // since the notification registry finds only instantiated channels.
    LoreDiscordNotificationChannel,
    ProjectEventJobs,
    ProjectEventCatalog,
    ProjectEvents,
    // Subscriptions and their delivery (#Q3890): the job is listed so the
    // queue knows it, the templates so the notification registry does.
    ProjectEventDelivery,
    ProjectEventDeliveryJobs,
    ProjectEventNotifications,
    ProjectRecipients,
    // The alert thresholds (#Q3894), core's since #E162: Build checks
    // coverage, Ship open errors.
    ProjectThresholds,
    ProjectThresholdController,
    SubscriptionService,
    SubscriptionController,
    // The hourly job and its registry of checks (#Q3893).
    HourlyChecks,
    HourlyJobs,
    // The catalog as a project sees it, and the filter pickers (#Q3892).
    ProjectEventCatalogService,
    ProjectEventFilters,
    ProjectEventController,
    ProjectEventReader,
    // The nightly backfill of the Admin and Viewer ranks; nothing injects it.
    DefaultRankJobs,
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
    ActivityChannel,
    DeliveryChangeRegistry,
    // Which deployed copy runs a quest's commits (#E154): Plan registers the
    // recorded commits, Ship the reads.
    LiveQuestRegistry,
    // The port host jobs start through (#Q3984).
    HostJobs,
    // The queues behind a host (#E166, core's since #Q4100): commands pushed
    // over the connection, one-shot jobs registered on the port above (the
    // agent jobs of #E163), their sweeps and the jobs pages' endpoints.
    HostCommandService,
    HostCommandJobs,
    // What a host IS, its inventory, its upgrade, and its lifecycle (#E166,
    // #Q4099): the cascade anchor kept on the home project's owner (#Q3278),
    // the overdue sweep (#Q3138), the refusal to delete a project that is
    // a host's home (#Q3280), and the host part of a project merge and
    // deletion. Nothing injects the hooks, guards and steps.
    HostService,
    HostInventoryService,
    HostUpgradeService,
    HostAnchorHooks,
    HostExpiryJobs,
    HostHomeGuards,
    // The monitor role (#E166, #Q4101): a host's stats, its offline and
    // online alerts, and the hosts card's resolver.
    HostStatsService,
    HostOfflineJobs,
    HostsMetric,
    // The agent role (#Q3985, core's since #E166): hosts that run Claude Code
    // jobs, their daily check, and the project's default one, Ship on or off.
    AgentHostService,
    AgentHostController,
    AgentHostJobs,
    // The host's HTTP, socket and pull surface (#E166, #Q4117): managing,
    // lending, enrolling and commanding a host, the machine's websocket and
    // the transport that pushes over it (substituted for
    // `HostCommandTransport` in `main.server.ts`), and the result and job
    // pulls. Ship keeps the deploy pulls (`HostPullController`).
    HostController,
    ProjectHostController,
    AdminHostController,
    HostEnrolController,
    HostSocketController,
    HostCommandController,
    HostCommandPullController,
    WebSocketHostCommandTransport,
    HostProjectMerge,
    HostProjectDeletion,
    HostJobService,
    HostJobJobs,
    HostJobController,
    // Job keys (#Q3995): the credential a host job holds, its pins checked on
    // every MCP call and git request it makes. Registers the port's issuer.
    JobKeyService,
    // Untrusted input in an agent's prompt (#Q3987).
    AgentRunPreamble,
    // The port agent jobs start through (#Q3988): Build registers it.
    AgentJobs,
    AgentJobService,
    // Prompts (#E174): the built-ins Plan registers, the project's own.
    PromptRegistry,
    PromptService,
    PromptRunService,
    PromptController,
    // A job that ends tells its starter, and its subscribers (#Q4276).
    AgentJobProjectEvents,
    // A prompt's triggers (#Q4277): events, schedule, check, ceilings.
    PromptTriggers,
    // A member arg emails the run's reply (#Q4278).
    PromptReplyMail,
    // Commits a push names a quest in (#Q3945): Plan records, Build calls.
    ChannelRoomRegistry,
    CommitReferenceRegistry,
    McpProjectScope,
    ProjectLimits,
    ProjectAnalyticsController,
    ProjectReportController,
    // Quality (#Q3070), a part of Reports since Build went (#Q4217): the
    // runs CI pushes, their tab, tiles, event, merge step and summary line.
    // The event, summary and merge step register themselves; nothing
    // injects them.
    QualityProjectEvents,
    QualityReportsSummary,
    QualityProjectMerge,
    QualityDashboardMetrics,
    QualityTrendMetric,
    QualityNumericCatalog,
    QualityNumericMetrics,
    QualityJobs,
    QualityService,
    CoverageThreshold,
    ProjectQualityReportService,
    QualityController,
    QualityReportsController,
    ProjectReportRegistry,
    ReportStatistics,
    ReportsSummaryController,
    ReportsSummaryRegistry,
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
    ProjectDashboardPresets,
    ProjectDashboardService,
    DashboardMetricRegistry,
    DashboardSlotRegistry,
    // "Needs you" (#Q2656): core's own metric over the modules' sources.
    DashboardAttentionRegistry,
    CoreDashboardMetrics,
    NeedsYouMetric,
    // The core tiles of #Q2659, and the momentum read Home shares.
    ProjectMomentumService,
    ActivityFeedMetric,
    MomentumMetric,
    NoteMetric,
    CoreDashboard,
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
    ProjectMergeController,
    // What the MCP surface is asked for, over time (#E65). Admin rather than
    // a project page: a tool call is not scoped to a project.
    AdminMcpController,
    SearchController,
    DashboardController,
    // The project board. A second controller rather than a branch inside the
    // one above: every path here hangs off `/projects/:projectId` and is
    // gated by `$ownsProject`, where home's hang off `/me` and cannot be.
    ProjectDashboardController,
    // Each user's dock of pinned projects (#E139): the rail's order.
    UserDockService,
    UserDockController,
    UserDockHooks,
  ],
  register: (alepha) => {
    // The Discord transport a channel's test post and delivery go through
    // (#Q3614, #Q3615). Optional, so a spec or the e2e server substitutes
    // `MemoryDiscordTransport` first.
    alepha.with({
      optional: true,
      provide: DiscordTransport,
      use: HttpDiscordTransport,
    });
    if (
      new DatabaseUrlParser().kind(
        alepha.env.DATABASE_URL as string | undefined,
      ) === "d1"
    )
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: LorePrimaryD1Provider,
      });
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
      ownerOnly: LoreRankBounds.NEVER_GRANTED,
      // Every project holds these four, renamable and never deleted (#Q3736).
      builtinRanks: [...LoreRankBounds.BUILTIN_RANKS],
      // Admin is read from the code until somebody edits it, like Member, so
      // a permission declared later reaches every Admin nobody touched
      // (#Q3920). Viewer stays a seeded row: its default is narrowed per
      // project by capability.
      defaultRanks: [
        {
          key: "admin",
          name: ProjectRankPresets.NAMES.admin,
          permissions: ProjectRankPresets.ADMIN,
        },
      ],
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
export { UserDockController } from "./controllers/UserDockController.ts";
export { UserDeletionHook } from "./hooks/UserDeletionHook.ts";
export { LoreInboxNotifications } from "./notifications/LoreInboxNotifications.ts";
export { NotificationHtmlEscaper } from "./notifications/NotificationHtmlEscaper.ts";
export { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
export { LoreFileAccessProvider } from "./providers/LoreFileAccessProvider.ts";
export { LoreInboxRecipientProvider } from "./providers/LoreInboxRecipientProvider.ts";
export { LoreNotificationPreferences } from "./providers/LoreNotificationPreferences.ts";
export {
  type ResourceRef,
  ResourceRegistry,
} from "./resources/ResourceRegistry.ts";
export { SearchPreview } from "./resources/SearchPreview.ts";
export { orderSearchHits } from "./searchRanking.ts";
export { $ownsProject } from "./security/$ownsProject.ts";
export { LoreOAuthScopes } from "./security/LoreOAuthScopes.ts";
export { LoreActivityPermissions } from "./security/LoreActivityPermissions.ts";
export { LoreViewerAllowlist } from "./security/LoreViewerAllowlist.ts";
export { LorePermissions } from "./security/LorePermissions.ts";
export { ProjectPermissions } from "./security/ProjectPermissions.ts";
export { ProjectRankPresets } from "./security/ProjectRankPresets.ts";
export { AssignedWorkRegistry } from "./services/AssignedWorkRegistry.ts";
export { BestEffort } from "./services/BestEffort.ts";
export { DefaultRankService } from "./services/DefaultRankService.ts";
export { ProjectReaderPermissions } from "./services/ProjectReaderPermissions.ts";
export { BoundParameters } from "./services/BoundParameters.ts";
export { DashboardCardService } from "./services/DashboardCardService.ts";
export { ProjectDashboardCardService } from "./services/ProjectDashboardCardService.ts";
export { ProjectDashboardPresets } from "./services/ProjectDashboardPresets.ts";
export { ProjectDashboardService } from "./services/ProjectDashboardService.ts";
export { DashboardMetricRegistry } from "./services/DashboardMetricRegistry.ts";
export { DashboardReadShare } from "./services/DashboardReadShare.ts";
export { ProjectMomentumService } from "./services/ProjectMomentumService.ts";
export { UserDockService } from "./services/UserDockService.ts";
export {
  type DashboardAttentionItem,
  type DashboardAttentionItems,
  type DashboardAttentionSource,
  DashboardAttentionRegistry,
} from "./services/DashboardAttentionRegistry.ts";
export {
  type ComputedDashboard,
  type DashboardSlot,
  type DashboardSlotCandidate,
  DashboardSlotRegistry,
} from "./services/DashboardSlotRegistry.ts";
export type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./services/DashboardMetricResolver.ts";
export {
  DashboardScopeService,
  type ResolvedDashboardScope,
} from "./services/DashboardScopeService.ts";
export {
  type FileAccessReader,
  FileAccessRegistry,
  type FileAccessRule,
} from "./services/FileAccessRegistry.ts";
export { LoreAuditService } from "./services/LoreAuditService.ts";
export { LoreAudits } from "./services/LoreAudits.ts";
export { ProjectCountRegistry } from "./services/ProjectCountRegistry.ts";
export {
  type ProjectDeletionGuard,
  ProjectDeletionService,
} from "./services/ProjectDeletionService.ts";
export {
  type ProjectCapabilityGuard,
  ProjectCapabilityGuards,
} from "./services/ProjectCapabilityGuards.ts";
export {
  type ProjectCapabilityHook,
  ProjectCapabilityHooks,
} from "./services/ProjectCapabilityHooks.ts";
export {
  ActivityChannel,
  type ActivityChannelValue,
} from "./services/ActivityChannel.ts";
export {
  type ProjectErrorForward,
  type DeliveryChange,
  DeliveryChangeRegistry,
} from "./services/DeliveryChangeRegistry.ts";
export {
  type ChannelRoom,
  type ChannelRoomProvider,
  ChannelRoomRegistry,
} from "./services/ChannelRoomRegistry.ts";
export {
  type CommitQuest,
  type CommitQuestReader,
  type CommitReferenceInput,
  type CommitLanding,
  type CommitLandingHandler,
  type CommitReferenceRecorder,
  type CommitReferenceResult,
  CommitReferenceRegistry,
} from "./services/CommitReferenceRegistry.ts";
export { AgentJobService } from "./services/AgentJobService.ts";
export { PromptController } from "./controllers/PromptController.ts";
export {
  type BuiltinPrompt,
  type PromptArgContext,
  type PromptArgItem,
  type PromptArgResolver,
  PromptRegistry,
  type PromptRunContext,
  type PromptRunPlan,
} from "./services/PromptRegistry.ts";
export { PromptService } from "./services/PromptService.ts";
export { PromptTriggers } from "./services/PromptTriggers.ts";
export { PromptReplyMail } from "./services/PromptReplyMail.ts";
export {
  type PromptRunBody,
  PromptRunService,
} from "./services/PromptRunService.ts";
export {
  type ProjectEventListener,
  ProjectEventListeners,
} from "./services/ProjectEventListeners.ts";
export { AgentJobs } from "./services/AgentJobs.ts";
export type { AgentJobRequest } from "./services/AgentJobs.ts";
export { AgentRunPreamble } from "./services/AgentRunPreamble.ts";
export { HostJobs } from "./services/HostJobs.ts";
export {
  type EpicMembership,
  type OutsideText,
  type OutsideTextSource,
  JobKeyService,
} from "./services/JobKeyService.ts";
export type {
  AgentHostDirectory,
  AgentHostRef,
  HostJobInput,
  HostJobKeyIssuer,
  HostJobKeyScope,
  HostJobQueue,
  HostJobRequest,
  HostJobSummary,
} from "./services/HostJobs.ts";
export {
  type LiveQuestInstance,
  type LiveQuestReader,
  type ProjectLiveness,
  type RecordedQuestCommits,
  LiveQuestRegistry,
} from "./services/LiveQuestRegistry.ts";
export { McpProjectScope } from "./services/McpProjectScope.ts";
export { ProjectLimits } from "./services/ProjectLimits.ts";
export {
  type ReportsGrain,
  ReportStatistics,
} from "./services/ReportStatistics.ts";
export { ReportsSummaryController } from "./controllers/ReportsSummaryController.ts";
export {
  ReportsSummaryRegistry,
  type ReportsSummarySource,
  type ReportsSummarySourceLine,
} from "./services/ReportsSummaryRegistry.ts";
export { ProjectMergeController } from "./controllers/ProjectMergeController.ts";
export {
  ProjectMergeNumbers,
  type ProjectMergeNumbering,
} from "./services/ProjectMergeNumbers.ts";
export {
  type ProjectMergeChange,
  type ProjectMergeConflict,
  type ProjectMergeContext,
  type ProjectMergeJoin,
  type ProjectMergePlan,
  type ProjectMergeRenumber,
  type ProjectMergeSequence,
  ProjectMergeService,
  type ProjectMergeStep,
  type ProjectMergeStepPlan,
} from "./services/ProjectMergeService.ts";
export { projectMergeWrite } from "./projectMergeWrite.ts";
export {
  ProjectMergeReferences,
  ProjectMergeRewriter,
} from "./services/ProjectMergeReferences.ts";
export {
  type ProjectMergeTable,
  ProjectMergeTables,
} from "./services/ProjectMergeTables.ts";
export { ProjectResourceMapper } from "./services/ProjectResourceMapper.ts";
export {
  ProjectRoster,
  type ProjectRosterEntry,
} from "./services/ProjectRoster.ts";
export { ProjectArchiveGuard } from "./services/ProjectArchiveGuard.ts";
export { ProjectSecurityService } from "./services/ProjectSecurityService.ts";
export { ResourceLinkService } from "./services/ResourceLinkService.ts";
export { ProjectAnalytics } from "./entities/projectAnalytics.ts";
export { ProjectAnalyticsController } from "./controllers/ProjectAnalyticsController.ts";
export { ProjectReportController } from "./controllers/ProjectReportController.ts";
export {
  type ProjectReportSection,
  ProjectReportRegistry,
} from "./services/ProjectReportRegistry.ts";

export { LoreDatabase } from "./services/LoreDatabase.ts";
export { LorePrimaryD1Provider } from "./providers/LorePrimaryD1Provider.ts";

export { GuardedBatch } from "./services/GuardedBatch.ts";

export { SourceRepository } from "./services/SourceRepository.ts";

export { ProjectChannelService } from "./services/ProjectChannelService.ts";
export { LoreDiscordNotificationChannel } from "./channels/LoreDiscordNotificationChannel.ts";
export { ProjectChannelController } from "./controllers/ProjectChannelController.ts";
export { CredentialSealService } from "./services/CredentialSealService.ts";

export { BatchRepository } from "./services/BatchRepository.ts";
export {
  ProjectEventCatalog,
  type ProjectEventDefinition,
  type ProjectEventFieldKind,
  type ProjectEventMessage,
  type ProjectEventResource,
} from "./services/ProjectEventCatalog.ts";
export {
  ProjectEvents,
  type ProjectEventInput,
} from "./services/ProjectEvents.ts";
export { ProjectEventJobs } from "./jobs/ProjectEventJobs.ts";
export { HourlyJobs } from "./jobs/HourlyJobs.ts";
export { HourlyChecks, type HourlyCheck } from "./services/HourlyChecks.ts";
export { ProjectEventDeliveryJobs } from "./jobs/ProjectEventDeliveryJobs.ts";
export { ProjectEventDelivery } from "./services/ProjectEventDelivery.ts";
export { ProjectEventNotifications } from "./notifications/ProjectEventNotifications.ts";
export { ProjectRecipients } from "./services/ProjectRecipients.ts";
export {
  type BuiltTag,
  BuiltTagRegistry,
  type BuiltTagSource,
} from "./services/BuiltTagRegistry.ts";
export {
  ProjectThresholds,
  type ThresholdArmed,
} from "./services/ProjectThresholds.ts";
export { ProjectThresholdController } from "./controllers/ProjectThresholdController.ts";
export {
  type ProjectThreshold,
  projectThresholds,
} from "./entities/projectThresholds.ts";
export {
  type ProjectThresholdsBody,
  projectThresholdsSchema,
} from "./schemas/projectThresholdsSchema.ts";
export { SubscriptionService } from "./services/SubscriptionService.ts";
export { SubscriptionController } from "./controllers/SubscriptionController.ts";
export { ProjectEventController } from "./controllers/ProjectEventController.ts";
export { ProjectEventReader } from "./services/ProjectEventReader.ts";
export { ProjectEventCatalogService } from "./services/ProjectEventCatalogService.ts";
export {
  ProjectEventFilters,
  type ProjectEventFilterSource,
} from "./services/ProjectEventFilters.ts";
export {
  eventSubscriptions,
  type EventSubscription,
} from "./entities/eventSubscriptions.ts";
export { projectEvents, type ProjectEvent } from "./entities/projectEvents.ts";
export { batchGuards, type BatchGuard } from "./entities/batchGuards.ts";

// ---- hosts (#E166) ----
export { AdminHostController } from "./controllers/AdminHostController.ts";
export { HostCommandController } from "./controllers/HostCommandController.ts";
export { HostController } from "./controllers/HostController.ts";
export type { HostResource } from "./controllers/HostController.ts";
export { HostEnrolController } from "./controllers/HostEnrolController.ts";
export { HostSocketController } from "./controllers/HostSocketController.ts";
export { ProjectHostController } from "./controllers/ProjectHostController.ts";
export type { LentHostResource } from "./controllers/ProjectHostController.ts";
export { WebSocketHostCommandTransport } from "./services/WebSocketHostCommandTransport.ts";
export { AgentHostService } from "./services/AgentHostService.ts";
export { AgentHostController } from "./controllers/AgentHostController.ts";
export { AgentHostJobs } from "./jobs/AgentHostJobs.ts";
export { HostOfflineJobs } from "./jobs/HostOfflineJobs.ts";
export { HostStatsService } from "./services/HostStatsService.ts";
export { HostsMetric } from "./services/HostsMetric.ts";
export { HostExpiryJobs } from "./jobs/HostExpiryJobs.ts";
export { HostUpgradeService } from "./services/HostUpgradeService.ts";
export { HostInventoryService } from "./services/HostInventoryService.ts";
export { HostService } from "./services/HostService.ts";
export { HostHomeGuards } from "./services/HostHomeGuards.ts";
export { HostAnchorHooks } from "./services/HostAnchorHooks.ts";
export { HostJobController } from "./controllers/HostJobController.ts";
export { HostJobService } from "./services/HostJobService.ts";
export { HostCommandService } from "./services/HostCommandService.ts";
export { HostCommandJobs } from "./jobs/HostCommandJobs.ts";
export { HostJobJobs } from "./jobs/HostJobJobs.ts";
export { HostCommandTransport } from "./services/HostCommandTransport.ts";
export { HostEventService } from "./services/HostEventService.ts";
export { HostTokenService } from "./services/HostTokenService.ts";
export { HostEventFields } from "./services/HostEventFields.ts";
export { HostCredentialRefused } from "./errors/HostCredentialRefused.ts";
export { BayReleaseTarget } from "./services/BayReleaseTarget.ts";
export { HostProjectEvents } from "./services/HostProjectEvents.ts";
export { CoreBuckets } from "./services/CoreBuckets.ts";
export {
  HostUsageRegistry,
  type HostReferenceReader,
  type HostTrackedApp,
  type HostTrackedAppReader,
} from "./services/HostUsageRegistry.ts";
export {
  HostTypeRegistry,
  type HostCredentialCheck,
  type HostCredentialField,
  type HostTypeBehaviour,
} from "./services/HostTypeRegistry.ts";
export {
  HostCommandHandlerRegistry,
  type HostCommandHandler,
  type HostCommandHandlerInput,
} from "./services/HostCommandHandlerRegistry.ts";
export { HostProjectMerge } from "./services/HostProjectMerge.ts";
export { HostProjectDeletion } from "./services/HostProjectDeletion.ts";
export { HostCommandPullController } from "./controllers/HostCommandPullController.ts";

// ---- Quality (#Q3070), core's since #Q4217 ----
export { QualityController } from "./controllers/QualityController.ts";
export { QualityReportsController } from "./controllers/QualityReportsController.ts";
export { QualityJobs } from "./jobs/QualityJobs.ts";
export { CoverageThreshold } from "./services/CoverageThreshold.ts";
export { QualityService } from "./services/QualityService.ts";
