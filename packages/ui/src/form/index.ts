import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export {
  Control,
  ControlArray,
  ControlDate,
  ControlNumber,
  ControlObject,
  ControlQueryBuilder,
  ControlSelect,
  TypeForm,
} from "@alepha/ui";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | frontend | standard | beta |
 *
 * Form components with automatic schema-driven generation.
 *
 * **Features:**
 * - Control component for individual form fields
 * - TypeForm for automatic form generation from TypeBox schemas
 * - Specialized controls: Array, Date, Number, Object, Select, QueryBuilder
 *
 * @module alepha.ui.form
 */
export const AlephaUIForm = $module({
  name: "alepha.ui.form",
});
