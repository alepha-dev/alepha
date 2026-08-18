import { AdminShipping } from "@alepha/commerce/shipping/components/admin-shipping";

/**
 * Delivery zones and rates, shipped by `@alepha/commerce/shipping`. The
 * application adds nothing — a back office that has to be rewritten per shop is
 * not a back office.
 */
const AdminLivraison = () => <AdminShipping />;

export default AdminLivraison;
