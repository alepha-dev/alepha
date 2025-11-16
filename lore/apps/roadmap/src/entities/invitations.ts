import { users } from "alepha/api/users";
import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";
import { projects } from "./projects.js";

export const invitations = $entity({
  name: "invitations",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    projectId: pg.ref(t.int(), () => projects.cols.id, {
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
