import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, pg } from "alepha/orm";
import { projects } from "./projects.ts";

export const invitations = $entity({
  name: "invitations",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    projectId: pg.ref(t.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    invitedBy: pg.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    invitedEmail: t.string({ format: "email" }),
    status: t.enum(["pending", "accepted", "rejected"], { default: "pending" }),
  }),
  indexes: [
    {
      columns: ["projectId", "invitedEmail"],
      unique: true,
    },
  ],
});

export type Invitation = Static<typeof invitations.schema>;
