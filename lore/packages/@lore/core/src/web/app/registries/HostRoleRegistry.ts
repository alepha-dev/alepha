import { AlephaError } from "alepha";
import { BarChart3, Bot, type LucideIcon } from "lucide-react";

/**
 * What a host does, as pills (#Q4047, #Q4065): its roles (#E166, folio
 * #F1537). Core owns the generic host and two roles, `stats` (monitor) and
 * `agent`; a module adds its own, as Ship adds `deploy` and Build will add
 * `ci`. `HostCapabilityBadges` draws every role that applies, in `order`.
 *
 * Frozen at first read, like the other registries a component loops over:
 * every module registers from its shell's constructor.
 */
export class HostRoleRegistry {
  protected readonly entries: HostRole[] = [
    {
      key: "stats",
      order: 10,
      icon: BarChart3,
      // Stats come from Bay's connector: a cloudflare account reports none.
      applies: (host) => host.type === "bay",
      label: () => "stats",
    },
    {
      key: "agent",
      order: 30,
      icon: Bot,
      testId: "host-agent",
      applies: (host) => host.agent !== undefined,
      label: (host, tr) =>
        host.agent === "default"
          ? tr("hosts.agent.pill.default")
          : tr("hosts.agent.pill"),
      tone: (host) => (host.agent === "default" ? "violet" : "neutral"),
      isDefault: (host) => host.agent === "default",
    },
  ];
  protected frozen = false;

  public register(role: HostRole): void {
    if (this.frozen) {
      throw new AlephaError(
        `Host role '${role.key}' registered after the roles were first read`,
      );
    }
    if (this.entries.some((it) => it.key === role.key)) {
      throw new AlephaError(`Host role '${role.key}' is already registered`);
    }
    this.entries.push(role);
  }

  public roles(): readonly HostRole[] {
    this.frozen = true;
    return [...this.entries].sort((a, b) => a.order - b.order);
  }

  /**
   * The roles that apply to one host, in order.
   */
  public of(host: HostRoleSubject): readonly HostRole[] {
    return this.roles().filter((role) => role.applies(host));
  }
}

/**
 * What a role reads off a host to decide whether it applies.
 */
export interface HostRoleSubject {
  type: string;
  /**
   * Whether this host takes deploys from where it is shown.
   */
  deployAllowed?: boolean;
  /**
   * Whether it is an Agent host there, and the project's default one.
   */
  agent?: "default" | "available";
}

export interface HostRole {
  key: string;
  order: number;
  icon: LucideIcon;
  applies: (host: HostRoleSubject) => boolean;
  label: (host: HostRoleSubject, tr: (key: any) => string) => string;
  tone?: (host: HostRoleSubject) => "neutral" | "violet";
  /**
   * The pill's `data-testid`, when a spec reads it.
   */
  testId?: string;
  /**
   * Marks the pill `data-default="true"`.
   */
  isDefault?: (host: HostRoleSubject) => boolean;
}
