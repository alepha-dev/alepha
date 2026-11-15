import type { Host } from "../entities/hosts.ts";

/**
 * The fields `host.credential_invalid` and `host.expired` carry (#Q3627),
 * shared by the recorded event and its subject preview: the host's id, slug
 * and kind, since when, and a link. Never the credential, never the check's
 * own message (it may quote what Cloudflare answered).
 */
export class HostAutomationFields {
  public build(
    project: { id: number; slug?: string | null; title: string },
    host: Host,
    kind: "credential_invalid" | "expired",
    since: string,
  ): Record<string, unknown> {
    const home = project.slug || `project-${project.id}`;
    return {
      project: project.title,
      title:
        kind === "credential_invalid"
          ? `${host.slug}: its Cloudflare token stopped working`
          : `${host.slug} is past its TTL`,
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
