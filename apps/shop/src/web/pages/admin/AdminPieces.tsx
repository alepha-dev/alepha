import { AdminProducts } from "@alepha/commerce/admin/components/admin-products";

/**
 * The catalogue screen is the one shipped by `@alepha/commerce/admin` — the
 * application adds nothing, which is the point: a back office that has to be
 * rewritten per shop is not a back office.
 */
const AdminPieces = () => <AdminProducts />;

export default AdminPieces;
