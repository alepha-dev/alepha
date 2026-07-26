import type { DevRoleMetadata } from "../../../schemas/DevRoleMetadata.ts";

export interface RoleColumnHeadProps {
  role: DevRoleMetadata;
}

/**
 * One role column header, shared by both matrices so the columns line up when
 * you switch tabs.
 *
 * The default role is marked with an asterisk rather than the word "default":
 * the header is 90px wide and the word doubles its width, but the mark is what
 * matters — every user gets this role's grants whether or not anyone assigned
 * them anything.
 */
export const RoleColumnHead = (props: RoleColumnHeadProps) => (
  <th style={{ width: 90 }}>
    <div style={{ textTransform: "none", letterSpacing: 0 }}>
      {props.role.name}
    </div>
    {props.role.default && (
      <div
        style={{ color: "var(--dt-danger)", lineHeight: 1 }}
        title="Assigned to every user automatically"
      >
        *
      </div>
    )}
  </th>
);
