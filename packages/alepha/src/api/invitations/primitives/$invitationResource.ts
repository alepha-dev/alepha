import { $inject, type Async, createPrimitive, KIND, Primitive } from "alepha";
import type { UserAccountToken } from "alepha/security";

import type { InvitationEntity } from "../entities/invitations.ts";
import { InvitationResourceProvider } from "../providers/InvitationResourceProvider.ts";

/**
 * Everything this module does NOT know about the thing being joined.
 *
 * An invitation has an address, a status machine, an expiry and a set of
 * caps, and none of those need to know what a project, a team or a booking
 * is. Six questions do, and they are the six below. An application answers
 * them once per `resourceType` and the module stays free of it.
 *
 * Arranged the way `$realm` hands closures to `alepha/server/auth`: the
 * module that owns the decision must not import the application, so the
 * application hands it functions.
 */
export interface InvitationResourcePrimitiveOptions {
  /**
   * The `resourceType` this resolver answers for, e.g. `"project"`. One
   * resolver per type; registering a second for the same type is refused at
   * boot rather than silently shadowing the first.
   */
  type: string;

  /**
   * May this inviter invite anyone to this resource at all? Throw if not.
   *
   * This is the authorization gate, and it is the application's because only
   * the application knows what owning one of these means. Nothing else in
   * `create` checks who the inviter is.
   */
  assertCanInvite: (
    resourceId: string,
    inviter: UserAccountToken,
  ) => Async<void>;

  /**
   * Is there room for one more principal? Throw if not.
   *
   * Asked twice, on purpose: at `create`, so an owner is told before anyone
   * is emailed, and again at `accept`, because that is where the principal
   * is actually added and where two invitations racing for the last seat
   * have to be separated. Omit it for a resource with no ceiling.
   */
  assertRoom?: (resourceId: string) => Async<void>;

  /**
   * Is this person already a principal on this resource?
   *
   * Identified by `userId` when there is an account and by `email` when
   * there is not one yet, which is why both are passed and only `email` is
   * guaranteed. At `create` time the invitee may have no account at all, so
   * an application that keys membership on user ids has to resolve the
   * address itself.
   */
  isPrincipal: (
    resourceId: string,
    principal: InvitationPrincipal,
  ) => Async<boolean>;

  /**
   * Make the accepting user a principal. Called once, only when
   * `isPrincipal` said no.
   *
   * The whole invitation is passed so `roles` and `metadata` are available:
   * this module carries them and never reads them.
   */
  grant: (userId: string, invitation: InvitationEntity) => Async<void>;

  /**
   * How a human sees this invitation: what they are being invited to, and by
   * whom.
   *
   * Both are the application's to answer. The resource's title is obviously
   * its own, and the inviter's name is too, because this module holds a user
   * id and deliberately no foreign key to a users table it does not own.
   *
   * Returning `undefined` (or omitting the closure) leaves the row
   * undescribed rather than failing the read: an inbox that cannot name one
   * resource should still list the others.
   */
  describe?: (
    invitation: InvitationEntity,
  ) => Async<InvitationDescription | undefined>;
}

/**
 * Who is being asked about, at the point in the flow where the question is
 * asked. `email` is always known; `userId` only once an account exists.
 */
export interface InvitationPrincipal {
  email: string;
  userId?: string;
}

export interface InvitationDescription {
  /**
   * What the invitee is being invited to, as they should read it.
   */
  resourceTitle?: string;

  /**
   * Who invited them, as they should read it.
   */
  inviterName?: string;
}

export class InvitationResourcePrimitive extends Primitive<InvitationResourcePrimitiveOptions> {
  protected readonly provider = $inject(InvitationResourceProvider);

  public get type(): string {
    return this.options.type;
  }

  protected onInit(): void {
    this.provider.register(this);
  }
}

/**
 * Teach the invitation module about one kind of resource.
 *
 * ```ts
 * class ProjectInvitations {
 *   project = $invitationResource({
 *     type: "project",
 *     assertCanInvite: (id, inviter) => this.security.assertOwner(+id, inviter),
 *     assertRoom: (id) => this.limits.assertRoom(+id),
 *     isPrincipal: (id, who) => this.members.has(+id, who),
 *     grant: (userId, invitation) =>
 *       this.members.add(+invitation.resourceId, userId),
 *     describe: (invitation) => this.describe(invitation),
 *   });
 * }
 * ```
 */
export const $invitationResource = (
  options: InvitationResourcePrimitiveOptions,
) => {
  return createPrimitive(InvitationResourcePrimitive, options);
};

$invitationResource[KIND] = InvitationResourcePrimitive;
