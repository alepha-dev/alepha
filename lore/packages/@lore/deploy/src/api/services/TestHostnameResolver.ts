import type { Estate } from "../entities/estates.ts";

/**
 * A hostname for a stack environment on a throwaway estate, with no DNS to
 * set up (#Q3137, owner 2026-11-06, folio #F1452 decision 4).
 *
 * `<env>-<stack>.<ip-with-dashes>.sslip.io`: sslip.io resolves any name that
 * ends in an IP to that IP, so the name points at the machine the moment it
 * exists, Bay's on-demand ACME obtains a real certificate for it, and nothing
 * is created in anyone's DNS or needs cleaning when the estate goes.
 *
 * ⚠️ One class owns the scheme, so the third-party resolver can be swapped
 * for a Lore-owned zone later without touching a caller.
 */
export class TestHostnameResolver {
  /**
   * The zone the hostname ends in.
   */
  protected readonly zone = "sslip.io";

  /**
   * The hostname, or `undefined` when the estate's public address is not
   * known or is not IPv4 (the dashed form this scheme writes).
   */
  hostnameFor(
    estate: Pick<Estate, "publicIp">,
    stack: string,
    env: string,
  ): string | undefined {
    const ip = estate.publicIp;
    if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return undefined;
    }
    const label = `${env}-${stack}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return `${label.slice(0, 63).replace(/-+$/, "")}.${ip.replaceAll(".", "-")}.${this.zone}`;
  }
}
