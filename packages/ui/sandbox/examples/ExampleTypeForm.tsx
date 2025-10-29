import { t } from "@alepha/core";
import { useRouter } from "@alepha/react";
import { useForm } from "@alepha/react-form";
import {
  Box,
  Button,
  Code,
  Flex,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBook } from "@tabler/icons-react";
import { Control, TypeForm } from "../../src";

const ExampleTypeForm = () => {
  const router = useRouter();

  // Basic TypeForm - Auto-generates all fields
  const basicForm = useForm({
    schema: t.object({
      username: t.text({ title: "Username" }),
      email: t.text({ format: "email", title: "Email" }),
      age: t.int({ title: "Age" }),
      subscribe: t.boolean({ title: "Subscribe to newsletter" }),
    }),
    handler: (values) => {
      notifications.show({
        title: "Basic Form Submitted",
        message: JSON.stringify(values, null, 2),
        color: "blue",
      });
    },
  });

  // Multi-column TypeForm
  const multiColumnForm = useForm({
    schema: t.object({
      firstName: t.text({ title: "First Name" }),
      lastName: t.text({ title: "Last Name" }),
      email: t.text({ format: "email", title: "Email" }),
      phone: t.text({ format: "tel", title: "Phone" }),
      address: t.text({ title: "Address" }),
      city: t.text({ title: "City" }),
      state: t.text({ title: "State" }),
      zip: t.text({ title: "ZIP Code" }),
    }),
    handler: (values) => {
      notifications.show({
        title: "Multi-Column Form Submitted",
        message: `Welcome, ${values.firstName} ${values.lastName}!`,
        color: "green",
      });
    },
  });

  // Complete registration form
  const registrationForm = useForm({
    schema: t.object({
      username: t.text({
        title: "Username",
        description: "Choose a unique username",
      }),
      email: t.text({
        format: "email",
        title: "Email Address",
        description: "We'll never share your email",
      }),
      password: t.text({
        title: "Password",
        description: "At least 8 characters",
      }),
      confirmPassword: t.text({
        title: "Confirm Password",
      }),
      age: t.int({
        title: "Age",
        description: "Must be 18 or older",
      }),
      role: t.enum(["developer", "designer", "manager", "other"], {
        title: "Role",
      }),
      interests: t.array(
        t.enum(["frontend", "backend", "mobile", "devops", "design"]),
        {
          title: "Interests",
          description: "Select all that apply",
        },
      ),
      bio: t.text({
        title: "Bio",
        description: "Tell us about yourself",
      }),
      website: t.text({
        format: "url",
        title: "Website",
        description: "Your personal website or portfolio",
      }),
      newsletter: t.boolean({
        title: "Subscribe to Newsletter",
      }),
      terms: t.boolean({
        title: "I accept the Terms & Conditions",
      }),
    }),
    handler: (values) => {
      console.log("Registration form submitted:", values);
      notifications.show({
        title: "Registration Successful!",
        message: `Welcome, ${values.username}! Check your email to verify your account.`,
        color: "green",
      });
    },
  });

  // Custom rendering with children
  const customForm = useForm({
    schema: t.object({
      email: t.text({ format: "email", title: "Email" }),
      password: t.text({ title: "Password" }),
      remember: t.boolean({ title: "Remember me" }),
    }),
    handler: (values) => {
      notifications.show({
        title: "Login Successful",
        message: `Welcome back, ${values.email}!`,
        color: "blue",
      });
    },
  });

  // Form with custom control props
  const customControlsForm = useForm({
    schema: t.object({
      username: t.text({ title: "Username" }),
      bio: t.text({ title: "Biography" }),
      theme: t.enum(["light", "dark", "auto"], { title: "Theme Preference" }),
    }),
    handler: (values) => {
      notifications.show({
        title: "Settings Saved",
        message: "Your preferences have been updated",
        color: "teal",
      });
    },
  });

  return (
    <Stack p="xl" maw={1200} mx="auto">
      {/* Header */}
      <Box>
        <Flex justify="space-between" align="center" mb="md">
          <Title order={1}>TypeForm Component Examples</Title>
        </Flex>
        <Text c="dimmed" size="lg">
          Auto-generated forms from TypeBox schemas with intelligent layout and
          validation
        </Text>
      </Box>

      {/* Basic TypeForm */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Basic TypeForm
        </Title>
        <Text c="dimmed" mb="lg">
          Simplest usage - just pass a form and it auto-generates all fields
        </Text>

        <TypeForm form={basicForm} />

        <Code block mt="xl">
          {`const form = useForm({
  schema: t.object({
    username: t.text({ title: "Username" }),
    email: t.text({ format: "email", title: "Email" }),
    age: t.int({ title: "Age" }),
    subscribe: t.boolean({ title: "Subscribe" }),
  }),
  handler: (values) => console.log(values),
});

<TypeForm form={form} />`}
        </Code>
      </Paper>

      {/* Multi-Column Layout */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Multi-Column Layout
        </Title>
        <Text c="dimmed" mb="lg">
          Automatically arranges fields in responsive columns
        </Text>

        <TypeForm form={multiColumnForm} columns={2} />

        <Code block mt="xl">
          {`<TypeForm form={form} columns={2} />

// Or responsive columns:
<TypeForm
  form={form}
  columns={{
    base: 1,  // Mobile: 1 column
    sm: 2,    // Small: 2 columns
    lg: 3     // Large: 3 columns
  }}
/>`}
        </Code>
      </Paper>

      {/* Complete Registration Form */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Complete Registration Form
        </Title>
        <Text c="dimmed" mb="lg">
          All field types with validation, descriptions, and auto-layout
        </Text>

        <TypeForm form={registrationForm} columns={2} />

        <Code block mt="xl">
          {`const form = useForm({
  schema: t.object({
    username: t.text({
      title: "Username",
      description: "Choose a unique username"
    }),
    email: t.text({
      format: "email",
      title: "Email"
    }),
    password: t.text({ title: "Password" }),
    age: t.int({ title: "Age" }),
    role: t.enum(["developer", "designer", "manager"]),
    interests: t.array(t.enum(["frontend", "backend"])),
    bio: t.text({ title: "Bio" }),
    website: t.text({ format: "url" }),
    newsletter: t.boolean(),
    terms: t.boolean(),
  }),
  handler: (values) => console.log(values),
});

<TypeForm form={form} columns={2} />`}
        </Code>
      </Paper>

      {/* Custom Rendering */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Custom Rendering with Children
        </Title>
        <Text c="dimmed" mb="lg">
          Use children function for complete control over field layout
        </Text>

        <TypeForm form={customForm} skipSubmitButton>
          {(input) => (
            <Stack gap="md">
              <Text size="xl" fw={700}>
                Welcome Back!
              </Text>
              <Text c="dimmed" mb="md">
                Sign in to your account
              </Text>

              <Control input={input.email} />
              <Control input={input.password} password />
              <Control input={input.remember} />

              <Button type="submit" fullWidth size="lg" mt="md">
                Sign In
              </Button>

              <Text size="sm" c="dimmed" ta="center">
                Don't have an account?{" "}
                <Text component="span" c="blue" style={{ cursor: "pointer" }}>
                  Sign up
                </Text>
              </Text>
            </Stack>
          )}
        </TypeForm>

        <Code block mt="xl">
          {`<TypeForm form={form} skipSubmitButton>
  {(input) => (
    <Stack>
      <Control input={input.email} />
      <Control input={input.password} password />
      <Control input={input.remember} />
      <Button type="submit">Sign In</Button>
    </Stack>
  )}
</TypeForm>`}
        </Code>
      </Paper>

      {/* Custom Control Props */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Custom Control Props
        </Title>
        <Text c="dimmed" mb="lg">
          Pass custom props to all controls at once
        </Text>

        <TypeForm
          form={customControlsForm}
          controlProps={{
            text: { variant: "filled" },
            area: { minRows: 4, autosize: true },
          }}
        />

        <Code block mt="xl">
          {`<TypeForm
  form={form}
  controlProps={{
    text: { variant: "filled" },
    area: { minRows: 4, autosize: true },
  }}
/>`}
        </Code>
      </Paper>

      {/* Skip Form Element */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Without Form Element
        </Title>
        <Text c="dimmed" mb="lg">
          Use <Code>skipFormElement</Code> when you need custom form wrapping
        </Text>

        <form
          {...basicForm.props}
          style={{
            padding: "1rem",
            border: "2px dashed var(--mantine-color-blue-3)",
            borderRadius: "8px",
          }}
        >
          <Text mb="md" c="blue" fw={500}>
            Custom form wrapper with dashed border
          </Text>

          <TypeForm form={basicForm} skipFormElement />
        </form>

        <Code block mt="xl">
          {`<form onSubmit={form.onSubmit} style={{ border: "2px dashed blue" }}>
  <TypeForm form={form} skipFormElement />
</form>`}
        </Code>
      </Paper>

      {/* Custom Submit Button */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Custom Submit Button
        </Title>
        <Text c="dimmed" mb="lg">
          Customize the submit button or hide it completely
        </Text>

        <Stack gap="xl">
          <Box>
            <Text size="sm" fw={500} mb="md">
              Custom button text and props:
            </Text>
            <TypeForm
              form={basicForm}
              submitButtonProps={{
                children: "Create Account",
                color: "green",
                size: "lg",
                leftSection: "🚀",
              }}
            />
          </Box>

          <Box>
            <Text size="sm" fw={500} mb="md">
              No submit button:
            </Text>
            <TypeForm form={basicForm} skipSubmitButton />
            <Button mt="md" variant="outline" fullWidth>
              Custom External Button
            </Button>
          </Box>
        </Stack>

        <Code block mt="xl">
          {`// Custom button
<TypeForm
  form={form}
  submitButtonProps={{
    children: "Create Account",
    color: "green",
    size: "lg",
  }}
/>

// No button
<TypeForm form={form} skipSubmitButton />
<Button onClick={form.onSubmit}>Custom Button</Button>`}
        </Code>
      </Paper>

      {/* API Reference */}
      <Paper shadow="xs" p="xl" withBorder>
        <Flex align="center" gap="xs" mb="md">
          <IconBook size={20} />
          <Title order={3}>API Reference</Title>
        </Flex>

        <Stack gap="lg">
          <Box>
            <Code>form: FormModel</Code>
            <Text size="sm" c="dimmed" mt="xs">
              Required. The form model from useForm()
            </Text>
          </Box>

          <Box>
            <Code>columns?: number | object</Code>
            <Text size="sm" c="dimmed" mt="xs">
              Number of columns (1-3) or responsive config. Default: 1
            </Text>
          </Box>

          <Box>
            <Code>children?: (input) =&gt; ReactNode</Code>
            <Text size="sm" c="dimmed" mt="xs">
              Custom render function for complete control
            </Text>
          </Box>

          <Box>
            <Code>controlProps?: Partial&lt;ControlProps&gt;</Code>
            <Text size="sm" c="dimmed" mt="xs">
              Props applied to all Control components
            </Text>
          </Box>

          <Box>
            <Code>skipFormElement?: boolean</Code>
            <Text size="sm" c="dimmed" mt="xs">
              Don't render {"<form>"} element. Default: false
            </Text>
          </Box>

          <Box>
            <Code>skipSubmitButton?: boolean</Code>
            <Text size="sm" c="dimmed" mt="xs">
              Don't render submit button. Default: false
            </Text>
          </Box>

          <Box>
            <Code>submitButtonProps?: Partial&lt;ActionSubmitProps&gt;</Code>
            <Text size="sm" c="dimmed" mt="xs">
              Props for the submit button
            </Text>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  );
};

export default ExampleTypeForm;
