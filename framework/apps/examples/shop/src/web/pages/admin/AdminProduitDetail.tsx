import { AdminProductDetail } from "@alepha/commerce/admin/components/admin-product-detail";

/**
 * One product's page, shipped by `@alepha/commerce/admin`. The application
 * supplies only the catalogue path, for the way back when an id matches
 * nothing.
 */
const AdminProduitDetail = () => (
  <AdminProductDetail backPath="/admin/produits" />
);

export default AdminProduitDetail;
