import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { t } from "alepha";
import { useForm } from "alepha/react/form";

const COUNTRIES = [
  { value: "FR", label: "France" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "DE", label: "Germany" },
  { value: "IT", label: "Italy" },
  { value: "ES", label: "Spain" },
  { value: "JP", label: "Japan" },
];

const schema = t.object({
  fullName: t.string({
    title: "Full name",
    $control: { autoComplete: "name", width: 100 },
  }),
  street: t.string({
    title: "Street address",
    $control: { autoComplete: "address-line1", width: 100 },
  }),
  street2: t.optional(
    t.string({
      title: "Apartment, suite, etc.",
      $control: { autoComplete: "address-line2", width: 100 },
    }),
  ),
  city: t.string({
    $control: { autoComplete: "address-level2", width: 50 },
  }),
  region: t.optional(
    t.string({
      title: "State / Region",
      $control: { autoComplete: "address-level1", width: 50 },
    }),
  ),
  postalCode: t.string({
    title: "Postal code",
    $control: { autoComplete: "postal-code", width: 33 },
  }),
  country: t.string({
    $control: {
      autoComplete: "country",
      items: COUNTRIES,
      width: 66,
    },
  }),
});

const AddressForm = () => {
  const toast = useToast();
  const form = useForm({
    schema,
    handler: (values) => toast.success(JSON.stringify(values, null, 2)),
  });

  return (
    <div className="container mx-auto max-w-2xl p-6">
      <AutoForm
        form={form}
        icon="user"
        title="Shipping address"
        description="Browser address autofill should populate every field."
        submitLabel="Save address"
      />
    </div>
  );
};

export default AddressForm;
