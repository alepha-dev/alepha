import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const schema = z.object({
  firstName: z
    .string()
    .min(1)
    .meta({
      $control: { autoComplete: "given-name", icon: "user", width: 50 },
    }),
  lastName: z
    .string()
    .min(1)
    .meta({ $control: { autoComplete: "family-name", width: 50 } }),
  email: z
    .string()
    .meta({ format: "email", $control: { autoComplete: "email", width: 100 } }),
  username: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/)
    .meta({ $control: { autoComplete: "username", icon: "user", width: 50 } })
    .describe("Lowercase letters, numbers, dashes."),
  phone: z
    .string()
    .meta({ $control: { autoComplete: "tel", icon: "phone", width: 50 } })
    .optional(),
  password: z
    .string()
    .min(8)
    .meta({
      $control: { password: true, autoComplete: "new-password", width: 50 },
    }),
  confirm: z
    .string()
    .min(8)
    .meta({
      title: "Confirm password",
      $control: { password: true, autoComplete: "new-password", width: 50 },
    }),
});

const RegisterForm = () => {
  const toast = useToast();
  const form = useForm({
    schema,
    handler: (values) => toast.success(`Register: ${JSON.stringify(values)}`),
  });

  return (
    <div className="container mx-auto max-w-2xl p-6">
      <AutoForm
        form={form}
        icon="user"
        title="Create account"
        description="Standard autocomplete tokens trigger browser address-book hints."
        submitLabel="Sign up"
      />
    </div>
  );
};

export default RegisterForm;
