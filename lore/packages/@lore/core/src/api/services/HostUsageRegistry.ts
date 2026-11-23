/**
 * What points at a host from a module that is not core (#E166, folio
 * #F1537). Hosts are core's and deploying is Ship's, so core's host services
 * ask here instead of reading Ship's tables:
 *
 * - **references**: the names of the resources that deploy to a host
 *   (`acme/production`, `stack (stack)`, `stack/env (stack)`), which
 *   `HostService.assertUnreferenced` refuses a delete or a detach over.
 *   Optionally scoped to one project, for a detach.
 * - **tracked apps**: the copies Lore expects on a host, which the
 *   inventory reconciles against what the machine reports.
 *
 * Both answer empty with nothing registered: a Lore without Ship has no
 * deploy target to protect and no copy to expect.
 */
export class HostUsageRegistry {
  protected readonly referenceReaders: HostReferenceReader[] = [];
  protected readonly trackedReaders: HostTrackedAppReader[] = [];

  public registerReferences(reader: HostReferenceReader): void {
    this.referenceReaders.push(reader);
  }

  public registerTrackedApps(reader: HostTrackedAppReader): void {
    this.trackedReaders.push(reader);
  }

  /**
   * Every resource naming this host, in registration order.
   */
  public async references(
    hostId: string,
    projectId?: number,
  ): Promise<string[]> {
    const named = await Promise.all(
      this.referenceReaders.map((reader) => reader(hostId, projectId)),
    );
    return named.flat();
  }

  /**
   * The copies Lore tracks on this host.
   */
  public async trackedApps(hostId: string): Promise<HostTrackedApp[]> {
    const tracked = await Promise.all(
      this.trackedReaders.map((reader) => reader(hostId)),
    );
    return tracked.flat();
  }
}

export type HostReferenceReader = (
  hostId: string,
  projectId?: number,
) => Promise<string[]>;

export type HostTrackedAppReader = (
  hostId: string,
) => Promise<HostTrackedApp[]>;

export interface HostTrackedApp {
  id: string;
  app: string;
  env: string;
  projectId: number;
}
