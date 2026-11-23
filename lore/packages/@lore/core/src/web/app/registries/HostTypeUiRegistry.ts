import { AlephaError } from "alepha";
import { type LucideIcon, Server } from "lucide-react";
import type { ComponentType } from "react";

import type { OwnedHostResource } from "../../../api/schemas/ownedHostResourceSchema.ts";

/**
 * The host types a person can add, and what each draws beyond what every
 * host has (#E166, folio #F1537). Core owns `bay`; a module adds its own
 * type, as Ship adds `cloudflare`: the fields its create needs and the
 * credential section of its drawer.
 *
 * Every registered type is offered in every project, Ship on or off
 * (review item 14): a project may exist only to store hosts and lend them.
 * Frozen at first read: a module registers from its constructor.
 */
export class HostTypeUiRegistry {
  protected readonly entries: HostTypeUi[] = [
    {
      type: "bay",
      order: 10,
      labelKey: "hosts.type.bay",
      descriptionKey: "hosts.type.bay.description",
      icon: Server,
    },
  ];
  protected frozen = false;

  public register(entry: HostTypeUi): void {
    if (this.frozen) {
      throw new AlephaError(
        `Host type '${entry.type}' registered after the types were first read`,
      );
    }
    this.entries.push(entry);
  }

  public all(): readonly HostTypeUi[] {
    this.frozen = true;
    return [...this.entries].sort((a, b) => a.order - b.order);
  }

  public get(type: string): HostTypeUi | undefined {
    return this.all().find((entry) => entry.type === type);
  }
}

export interface HostTypeUi {
  type: "bay" | "cloudflare";
  order: number;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  /**
   * The fields this type's create asks for, inside the create form.
   */
  CreateFields?: ComponentType<HostTypeCreateFieldsProps>;
  /**
   * This type's section of a host's drawer.
   */
  DrawerSection?: ComponentType<HostTypeDrawerSectionProps>;
}

export interface HostTypeCreateFieldsProps {
  /**
   * The create form: `form.input.<field>` for a `Control`. Typed loosely
   * because the form's schema is core's and the fields are the module's.
   */
  form: { input: Record<string, any> };
  busy: boolean;
  errorFor: (field: "accountId" | "token") => string | undefined;
}

export interface HostTypeDrawerSectionProps {
  host: OwnedHostResource;
  canUpdate: boolean;
  busy: boolean;
  onChanged: (host: OwnedHostResource) => void;
}
