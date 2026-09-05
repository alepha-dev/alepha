import AdminUserDetail from "@alepha/ui/components/admin/admin-user-detail";

/**
 * Mounted at `/admin/users/:userId`, NOT under `/blocks`.
 *
 * ⚠️ That path is not a choice. `AdminUsers` navigates with a hardcoded
 * `router.push(\`/admin/users/${u.id}\`)` - it is not a prop - so any other
 * route leaves every row linking to a 404. A crawl found exactly that: nine
 * dangling links, one per user.
 *
 * The component reads the id from the route params itself (`userId` or `id`),
 * so the `:userId` segment above is what feeds it.
 *
 * `backPath` has to be passed. It defaults to `/admin/users`, which is
 * `AdminRouter`'s list page and does not exist here, so Back would have been a
 * second broken link.
 *
 * Rendered bare, without `BlockPage`: this is the destination of a link inside
 * another component, and showcase chrome would misrepresent what an
 * application actually renders here.
 */
const UserDetail = () => <AdminUserDetail backPath="/blocks/admin/users" />;

export default UserDetail;
