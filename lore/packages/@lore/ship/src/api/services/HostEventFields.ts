import type { Host } from "@lore/core/schemas";

/**
 * The `host.*` events, by the part after the dot.
 */
export type HostAlertKind =
  | "credential_invalid"
  | "expired"
  | "offline"
  | "online";

/**
 * The fields every `host.*` event carries (#Q3627, #Q3733, #Q3889), as data:
 * the host's id, slug and kind, its state (the part of the event name after
 * the dot), since when, and a link. The sentence a member reads is the
 * message's job. Never the credential, never the check's own message (it
 * may quote what Cloudflare answered).
 */
export class HostEventFields {
  public build(
    project: { id: number; slug?: string | null; title: string },
    host: Host,
    kind: HostAlertKind,
    since: string,
  ): Record<string, unknown> {
    const home = project.slug || `project-${project.id}`;
    return {
      project: project.title,
      title: host.slug,
      host_id: host.id,
      host: host.slug,
      kind: host.type,
      state: kind,
      since,
      url:
        host.type === "bay"
          ? `/${home}/hosts/${host.slug}`
          : `/${home}/settings/hosts`,
    };
  }
}
