import type { InvitationEntity } from "../entities/invitations.ts";

/**
 * Abstract provider that apps implement to customize invitation behavior
 * per resource type.
 */
export abstract class InvitationProvider {
  /**
   * Validate that the resource exists and the inviter has permission to invite.
   * Throw BadRequestError/ForbiddenError to reject.
   */
  abstract validateResource(
    resourceType: string,
    resourceId: string,
    inviter: { id: string; email?: string },
  ): Promise<void>;

  /**
   * Check if the email is already a member of the resource.
   * Return true to reject the invitation as duplicate membership.
   */
  abstract isMember(
    resourceType: string,
    resourceId: string,
    email: string,
    userId?: string,
  ): Promise<boolean>;

  /**
   * Called when an invitation is accepted.
   * Create membership records, assign roles, etc.
   */
  abstract onAccept(
    invitation: InvitationEntity,
    acceptedBy: { id: string; email?: string },
  ): Promise<void>;

  /**
   * Return display info for the resource (used in API responses).
   */
  abstract getResourceInfo(
    resourceType: string,
    resourceId: string,
  ): Promise<{ name: string; description?: string; url?: string }>;
}
