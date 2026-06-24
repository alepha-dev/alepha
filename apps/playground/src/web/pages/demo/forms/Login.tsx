import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const schema = z.object({
  email: z
    .string()
    .meta({
      format: "email",
      $control: { autoComplete: "username", icon: "user", width: 100 },
    })
    .describe("We never share your address."),
  password: z
    .string()
    .meta({
      $control: {
        password: true,
        autoComplete: "current-password",
        width: 100,
      },
    })
    .describe("At least 8 characters."),
  remember: z
    .boolean()
    .meta({ title: "Remember me", $control: { width: 100 } })
    .optional(),
});

const LoginForm = () => {
  const toast = useToast();
  const form = useForm({
    schema,
    handler: (values) => toast.success(`Login: ${JSON.stringify(values)}`),
  });

  return (
    <div className="container mx-auto max-w-sm p-6">
      <AutoForm
        form={form}
        icon="user"
        title="Sign in"
        description="Browser autocomplete will offer saved credentials."
        submitLabel="Sign in"
      />
    </div>
  );
};

export default LoginForm;
