import { $atom } from "alepha";
import { organizationMembers } from "alepha/api/organizations";

export const currentProjectMemberAtom = $atom({
  name: "lor.current.project_member",
  schema: organizationMembers.schema.optional(),
});
