import type { Host } from "../entities/hosts.ts";

/**
 * The `host.*` events, by the part after the dot.
 */
export type HostAlertKind =
  | "credential_invalid"
  | "expired"
  | "offline"
  | "online";

/**
 * The fields every `host.*` event carries (#Q3627, #Q3733),
 * shared by the recorded event and its subject preview: the host's id, slug
 * and kind, since when, and a link. Never the credential, never the check's
 * own message (it may quote what Cloudflare answered).
 */
export class HostAutomationFields {
  public static readonly titles: Record<
    HostAlertKind,
    (slug: string) => string
  > = {
    credential_invalid: (slug) =>
      `${slug}: its Cloudflare token stopped working`,
    expired: (slug) => `${slug} is past its TTL`,
    offline: (slug) => `${slug} is offline`,
    online: (slug) => `${slug} is back online`,
  };
  public build(
    project: { id: number; slug?: string | null; title: string },
    host: Host,
    kind: HostAlertKind,
    since: string,
  ): Record<string, unknown> {
    const home = project.slug || `project-${project.id}`;
    return {
      project: project.title,
      title: HostAutomationFields.titles[kind](host.slug),
      host_id: host.id,
      host: host.slug,
      kind: host.type,
      since,
      url:
        host.type === "bay"
          ? `/${home}/hosts/${host.slug}`
          : `/${home}/settings/hosts`,
    };
  }
}
