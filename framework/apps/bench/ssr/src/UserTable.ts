import { createElement as h } from "react";

import type { User } from "./users.ts";

export interface UserTableProps {
  rows: User[];
}

/**
 * A table of users, written with `createElement` rather than JSX so the
 * Express twin renders this very module, unbuilt, under Node's type
 * stripping: both servers render the same component.
 */
const UserTable = (props: UserTableProps) =>
  h(
    "main",
    null,
    h("h1", null, `${props.rows.length} users`),
    h(
      "table",
      null,
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", null, "Id"),
          h("th", null, "Name"),
          h("th", null, "Email"),
          h("th", null, "Age"),
        ),
      ),
      h(
        "tbody",
        null,
        props.rows.map((row) =>
          h(
            "tr",
            { key: row.id },
            h("td", null, row.id),
            h("td", null, row.name),
            h("td", null, h("a", { href: `mailto:${row.email}` }, row.email)),
            h("td", null, row.age),
          ),
        ),
      ),
    ),
  );

export default UserTable;
