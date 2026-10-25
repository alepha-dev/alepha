import { AdminProducts } from "@alepha/commerce/admin/components/admin-products";

/**
 * The catalogue screen is the one shipped by `@alepha/commerce/admin` — the
 * application adds nothing but the path its detail page is mounted at, which is
 * the one thing the package cannot know.
 */
const AdminProduits = () => <AdminProducts detailPath="/admin/produits" />;

export default AdminProduits;
