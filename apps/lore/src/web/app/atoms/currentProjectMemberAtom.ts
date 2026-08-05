import { $atom } from "alepha";
import { members } from "@/api/entities/members.ts";

export const currentProjectMemberAtom = $atom({
  name: "lor.current.project_member",
  schema: members.schema.optional(),
});
