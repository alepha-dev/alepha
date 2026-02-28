import ParameterDetailsConfigForm from "./ParameterDetailsConfigForm.tsx";
import ParameterDetailsLoading from "./ParameterDetailsLoading.tsx";
import type { ParameterValue } from "./types.ts";

interface Props {
  selectedConfig: string | null;
  configValue: ParameterValue | null;
  loading: boolean;
  saving: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}

/**
 * Parameter details panel.
 * Shows loading state or the config form.
 * Note: Empty state is handled by parent (AdminParameters).
 */
const ParameterDetails = (props: Props) => {
  // Loading state
  if (props.loading) {
    return <ParameterDetailsLoading />;
  }

  // Config form (selectedConfig is guaranteed to be non-null by parent)
  return (
    <ParameterDetailsConfigForm
      selectedConfig={props.selectedConfig!}
      configValue={props.configValue}
      saving={props.saving}
      onSave={props.onSave}
    />
  );
};

export default ParameterDetails;
