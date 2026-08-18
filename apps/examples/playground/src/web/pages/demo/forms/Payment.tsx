import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const schema = z.object({
  cardholder: z.string().meta({
    title: "Name on card",
    $control: { autoComplete: "cc-name", width: 100 },
  }),
  cardNumber: z
    .string()
    .regex(/^[0-9 ]+$/)
    .meta({
      title: "Card number",
      $control: {
        autoComplete: "cc-number",
        placeholder: "1234 5678 9012 3456",
        width: 100,
      },
    }),
  expiry: z
    .string()
    .regex(/^[0-9]{2}\/[0-9]{2}$/)
    .meta({
      title: "Expiration",
      $control: {
        autoComplete: "cc-exp",
        placeholder: "MM/YY",
        width: 50,
      },
    }),
  cvc: z
    .string()
    .regex(/^[0-9]{3,4}$/)
    .meta({
      title: "CVC",
      $control: {
        autoComplete: "cc-csc",
        placeholder: "123",
        width: 50,
      },
    }),
});

const PaymentForm = () => {
  const toast = useToast();
  const form = useForm({
    schema,
    handler: (values) => toast.success(JSON.stringify(values, null, 2)),
  });

  return (
    <div className="container mx-auto max-w-md p-6">
      <AutoForm
        form={form}
        icon="user"
        title="Payment details"
        description="Browser will offer saved cards via cc-* autocomplete."
        submitLabel="Pay"
      />
    </div>
  );
};

export default PaymentForm;
