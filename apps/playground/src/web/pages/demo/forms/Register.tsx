import { AutoForm } from "@alepha/ui/components/auto-form";
import { t } from "alepha";
import { useForm } from "alepha/react/form";
import { toast } from "sonner";

const schema = t.object({
  firstName: t.string({
    minLength: 1,
    $control: { autoComplete: "given-name", icon: "user", width: 50 },
  }),
  lastName: t.string({
    minLength: 1,
    $control: { autoComplete: "family-name", width: 50 },
  }),
  email: t.string({
    format: "email",
    $control: { autoComplete: "email", width: 100 },
  }),
  username: t.string({
    minLength: 3,
    description: "Lowercase letters, numbers, dashes.",
    pattern: "^[a-z0-9-]+$",
    $control: { autoComplete: "username", icon: "user", width: 50 },
  }),
  phone: t.optional(
    t.string({
      $control: { autoComplete: "tel", icon: "phone", width: 50 },
    }),
  ),
  password: t.string({
    minLength: 8,
    $control: { password: true, autoComplete: "new-password", width: 50 },
  }),
  confirm: t.string({
    minLength: 8,
    title: "Confirm password",
    $control: { password: true, autoComplete: "new-password", width: 50 },
  }),
});

const RegisterForm = () => {
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
