import { AlephaError } from "alepha";
import { NotFoundError } from "alepha/server";

import type { InvitationResourcePrimitive } from "../primitives/$invitationResource.ts";

/**
 * The registry of `$invitationResource` declarations, keyed by
 * `resourceType`.
 *
 * Separate from `InvitationService` so the primitive can register into it
 * without the service, and everything the service pulls in, having to be
 * constructed at field-initialisation time.
 */
export class InvitationResourceProvider {
  protected readonly resolvers = new Map<string, InvitationResourcePrimitive>();

  public register(primitive: InvitationResourcePrimitive): void {
    const existing = this.resolvers.get(primitive.type);
    if (existing && existing !== primitive) {
      // Refused rather than overwritten: two resolvers for one type means two
      // different answers to "may this inviter invite" for the same rows, and
      // whichever registered last would silently win.
      throw new AlephaError(
        `An invitation resource of type "${primitive.type}" is already registered. ` +
          `Each resourceType may have exactly one $invitationResource.`,
      );
    }
    this.resolvers.set(primitive.type, primitive);
  }

  /**
   * The resolver for a type, or a 404.
   *
   * A `resourceType` with no resolver is a request naming something this
   * application does not invite to. It answers the same way it would for a
   * resource that does not exist, because to the caller that is what it is.
   */
  public get(resourceType: string): InvitationResourcePrimitive {
    const resolver = this.resolvers.get(resourceType);
    if (!resolver) {
      throw new NotFoundError(
        `No invitation resource registered for type "${resourceType}"`,
      );
    }
    return resolver;
  }

  /**
   * The resolver for a type, or nothing. For read paths that must survive a
   * row whose type has since been removed from the application.
   */
  public find(resourceType: string): InvitationResourcePrimitive | undefined {
    return this.resolvers.get(resourceType);
  }

  public get types(): string[] {
    return [...this.resolvers.keys()];
  }
}
