import { $permission } from "alepha/security";

export class OrganizationPermissions {
  public readonly organizationUpdate = $permission({
    group: "organization",
    name: "update",
    label: "permission.organization.update",
    groupLabel: "permission.group.organization",
    groupOrder: 1,
  });

  public readonly organizationDelete = $permission({
    group: "organization",
    name: "delete",
    label: "permission.organization.delete",
  });

  public readonly memberRead = $permission({
    group: "member",
    name: "read",
    label: "permission.member.read",
    groupLabel: "permission.group.member",
    groupOrder: 2,
  });

  public readonly memberManage = $permission({
    group: "member",
    name: "manage",
    label: "permission.member.manage",
  });

  public readonly rankManage = $permission({
    group: "rank",
    name: "manage",
    label: "permission.rank.manage",
    groupLabel: "permission.group.rank",
    groupOrder: 3,
  });

  public readonly invitationCreate = $permission({
    group: "invitation",
    name: "create",
    label: "permission.invitation.create",
    groupLabel: "permission.group.invitation",
    groupOrder: 4,
  });
}
