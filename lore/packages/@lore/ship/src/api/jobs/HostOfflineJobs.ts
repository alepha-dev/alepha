import {
  HostProjectEvents,
  SourceRepository,
  HostEventFields,
  HostService,
} from "@lore/core/api";
import { projects, type Host, hosts } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { ConflictError } from "alepha/server";

/**
 * Raises `host.offline` once per outage, when a Bay host has been gone for
 * longer than {@link HostOfflineJobs.GRACE_MS}, and `host.online` when it is
 * back (#Q3733).
 *
 * ## Why a sweep and not the socket's close
 *
 * The close event runs inside the Durable Object that held the socket, and
 * can be lost; and a Bay restart or upgrade closes the socket for a few
 * seconds, which must page nobody. So the socket only stamps the row, and
 * this sweep decides from the stamps, with `HostService.isOnline`'s rule:
 * a host whose close was lost reads offline once it has been silent for
 * twice its stats interval, and its outage is dated from there.
 *
 * ## One event per outage
 *
 * ⚠️ The claim IS the update, as in `HostExpiryJobs`: `offlineSince` is set
 * by the UPDATE that records `host.offline`, guarded on it being null, and
 * cleared by the one that records `host.online`, guarded on it being set.
 * Both also require `connectedAt` unchanged since the read, so a host that
 * reconnects between the read and the write is never reported offline.
 *
 * A host past its TTL is not reported offline: a throwaway server going away
 * is what its TTL said it would do.
 */
export class HostOfflineJobs {
  /**
   * Injected so the events this class records are in the catalog
   * whatever booted it (#Q3889).
   */
  protected readonly eventDefinitions = $inject(HostProjectEvents);
  /**
   * How long a host must stay gone before anyone is told. A Bay restart or
   * upgrade reconnects in seconds; five minutes is far past that and still
   * short against a night.
   */
  public static readonly GRACE_MS = 5 * 60 * 1000;

  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly hosts = $repository(hosts);
  protected readonly projects = $repository(projects);
  protected readonly sources = $inject(SourceRepository.of(hosts));
  protected readonly fields = $inject(HostEventFields);
  protected readonly service = $inject(HostService);

  public readonly notifyOffline = $job({
    name: "hosts.notify-offline",
    description:
      "Raises host.offline once per outage for a Bay host gone past its grace period, and host.online when it is back.",
    cron: "* * * * *",
    timeout: [60, "seconds"],
    retry: { retries: 2 },
    handler: async () => {
      await this.sweep();
    },
  });

  /**
   * One pass: every Bay host that ever connected, offline ones past the
   * grace period reported, returned ones cleared. Returns how many events
   * were raised.
   */
  public async sweep(): Promise<{ offline: number; online: number }> {
    const now = this.dateTime.nowMillis();
    const rows = await this.hosts.findMany({
      where: { type: { eq: "bay" }, connectedAt: { isNotNull: true } },
      limit: 1000,
    });
    const raised = { offline: 0, online: 0 };
    for (const host of rows) {
      const online = this.service.isOnline(host, now);
      if (host.offlineSince) {
        if (online && (await this.back(host))) raised.online++;
        continue;
      }
      if (online || this.service.isOverdue(host, now)) continue;
      const since = this.offlineSince(host);
      if (now - Date.parse(since) < HostOfflineJobs.GRACE_MS) continue;
      if (await this.gone(host, since)) raised.offline++;
    }
    if (raised.offline || raised.online)
      this.log.info("Raised host.offline / host.online", raised);
    return raised;
  }

  /**
   * When the outage began: the close, if one was recorded after the last
   * connect; otherwise the moment the silence crossed `isOnline`'s bound
   * (twice the stats interval after the last frame), since a lost close
   * leaves nothing earlier to go by.
   */
  protected offlineSince(host: Host): string {
    const connected = Date.parse(host.connectedAt!);
    if (host.disconnectedAt && Date.parse(host.disconnectedAt) >= connected)
      return host.disconnectedAt;
    const seen = host.lastSeenAt ? Date.parse(host.lastSeenAt) : connected;
    return new Date(seen + host.statsIntervalSeconds * 2 * 1000).toISOString();
  }

  protected async gone(host: Host, since: string): Promise<boolean> {
    return this.raise(
      host,
      { offlineSince: { isNull: true } },
      { offlineSince: since },
      "offline",
      since,
    );
  }

  protected async back(host: Host): Promise<boolean> {
    const since = host.offlineSince!;
    return this.raise(
      host,
      { offlineSince: { eq: since } },
      { offlineSince: null },
      "online",
      since,
    );
  }

  protected async raise(
    host: Host,
    where: Record<string, unknown>,
    data: { offlineSince: string | null },
    kind: "offline" | "online",
    since: string,
  ): Promise<boolean> {
    try {
      await this.sources.sourceUpdate(
        {
          id: host.id,
          connectedAt: { eq: host.connectedAt! },
          ...where,
        } as never,
        data,
        {
          projectId: host.projectId,
          resourceId: host.id,
          name: `host.${kind}`,
          subjectId: host.id,
          fields: this.fields.build(
            await this.projects.getById(host.projectId),
            host,
            kind,
            since,
          ),
        },
      );
      return true;
    } catch (error) {
      // Another sweep claimed it first, or the host reconnected since the
      // read: either way there is nothing to say this time.
      if (!(error instanceof ConflictError)) throw error;
      return false;
    }
  }
}
