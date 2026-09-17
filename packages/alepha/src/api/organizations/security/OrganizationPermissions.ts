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
}
