import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { t } from "alepha";
import { useForm } from "alepha/react/form";

const schema = t.object({
  email: t.string({
    format: "email",
    description: "We never share your address.",
    $control: { autoComplete: "username", icon: "user", width: 100 },
  }),
  password: t.string({
    description: "At least 8 characters.",
    $control: {
      password: true,
      autoComplete: "current-password",
      width: 100,
    },
  }),
  remember: t.optional(
    t.boolean({
      title: "Remember me",
      $control: { width: 100 },
    }),
  ),
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
