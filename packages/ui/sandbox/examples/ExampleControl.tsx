import { useRouter } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { Control, DarkModeButton } from "@alepha/ui";
import {
  Anchor,
  Box,
  Button,
  Code,
  Divider,
  Flex,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconRocket } from "@tabler/icons-react";
import { t } from "alepha";

const ExampleControl = () => {
  const router = useRouter();

  // Text inputs form
  const textForm = useForm({
    id: "text",
    schema: t.object({
      username: t.text({
        title: "Username",
        description: "Choose a unique username",
      }),
      email: t.text({ format: "email", title: "Email Address" }),
      website: t.text({
        format: "url",
        title: "Website",
        description: "Your personal website",
      }),
      phone: t.text({ format: "tel", title: "Phone Number" }),
    }),
    handler: (values) => console.log(values),
  });

  // Number inputs form
  const numberForm = useForm({
    id: "number",
    schema: t.object({
      age: t.integer({ title: "Age", description: "Must be 18 or older" }),
      price: t.number({ title: "Price", description: "Enter amount in USD" }),
    }),
    handler: (values) => console.log(values),
  });

  // Boolean form
  const booleanForm = useForm({
    id: "boolean",
    schema: t.object({
      newsletter: t.boolean({ title: "Subscribe to Newsletter" }),
      terms: t.boolean({ title: "Accept Terms & Conditions" }),
    }),
    handler: (values) => console.log(values),
  });

  // Password form
  const passwordForm = useForm({
    id: "password",
    schema: t.object({
      password: t.text({
        title: "Password",
        description: "At least 8 characters",
      }),
      confirmPassword: t.text({ title: "Confirm Password" }),
    }),
    handler: (values) => console.log(values),
  });

  // Textarea form
  const textareaForm = useForm({
    id: "textarea",
    schema: t.object({
      bio: t.text({
        title: "Biography",
        description: "Tell us about yourself",
      }),
    }),
    handler: (values) => console.log(values),
  });

  // Color form
  const colorForm = useForm({
    id: "color",
    schema: t.object({
      themeColor: t.text({ format: "color", title: "Theme Color" }),
    }),
    handler: (values) => console.log(values),
  });

  // Select form
  const selectForm = useForm({
    id: "select",
    schema: t.object({
      role: t.enum(["admin", "user", "guest"], { title: "User Role" }),
    }),
    handler: (values) => console.log(values),
  });

  // Segmented form
  const segmentedForm = useForm({
    id: "segmented",
    schema: t.object({
      status: t.enum(["active", "inactive", "pending"], { title: "Status" }),
    }),
    handler: (values) => console.log(values),
  });

  // Icons form
  const iconsForm = useForm({
    id: "icons",
    schema: t.object({
      email: t.text({ format: "email", title: "Email Address" }),
      password: t.text({ title: "Password" }),
      phone: t.text({ format: "tel", title: "Phone Number" }),
      username: t.text({ title: "Username" }),
    }),
    handler: (values) => console.log(values),
  });

  // Custom props form
  const customPropsForm = useForm({
    id: "customprops",
    schema: t.object({
      username: t.text({ title: "Username" }),
      bio: t.text({ title: "Biography" }),
    }),
    handler: (values) => console.log(values),
  });

  // Submit form
  const submitForm = useForm({
    id: "submit",
    schema: t.object({
      name: t.text({ title: "Name" }),
      email: t.text({ format: "email", title: "Email" }),
    }),
    handler: (values) => {
      console.log("Form submitted:", values);
      alert(JSON.stringify(values, null, 2));
    },
  });

  return (
    <Stack p="xl" maw={1200} mx="auto">
      {/* Header */}
      <Box>
        <Flex justify="space-between" align="center" mb="md">
          <Title order={1}>Control Component Examples</Title>
          <Flex gap="md" align="center">
            <Anchor onClick={() => router.go("/action")} c="blue" fw={500}>
              View Action Examples →
            </Anchor>
            <Anchor onClick={() => router.go("/typeform")} c="blue" fw={500}>
              View TypeForm Examples →
            </Anchor>
            <DarkModeButton mode="segmented" />
          </Flex>
        </Flex>
        <Text c="dimmed" size="lg">
          Comprehensive examples of the auto-generated form controls with
          TypeBox schemas
        </Text>
      </Box>

      <Divider my="xl" />

      {/* Text Inputs */}
      <Paper p="xl" withBorder>
        <Title order={2} mb="md">
          Text Inputs with Format Detection
        </Title>
        <Text c="dimmed" mb="lg">
          Automatically detects HTML5 input types from format
        </Text>

        <Stack gap="md">
          <Control input={textForm.input.username} />

          <Box>
            <Control input={textForm.input.email} />
            <Code block mt="xs">
              {`t.text({ format: "email" })`}
            </Code>
          </Box>

          <Box>
            <Control input={textForm.input.website} />
            <Code block mt="xs">
              {`t.text({ format: "url" })`}
            </Code>
          </Box>

          <Box>
            <Control input={textForm.input.phone} />
            <Code block mt="xs">
              {`t.text({ format: "tel" })`}
            </Code>
          </Box>
        </Stack>
      </Paper>

      {/* Number Inputs */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Number Inputs
        </Title>
        <Text c="dimmed" mb="lg">
          Auto-detected from integer and number schema types
        </Text>

        <Stack gap="md">
          <Box>
            <Control input={numberForm.input.age} />
            <Code block mt="xs">
              {`t.integer({ title: "Age" })`}
            </Code>
          </Box>

          <Box>
            <Control input={numberForm.input.price} />
            <Code block mt="xs">
              {`t.number({ title: "Price" })`}
            </Code>
          </Box>
        </Stack>
      </Paper>

      {/* Boolean Inputs */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Boolean Switches
        </Title>
        <Text c="dimmed" mb="lg">
          Auto-detected from boolean schema type
        </Text>

        <Stack gap="md">
          <Control input={booleanForm.input.newsletter} />
          <Control input={booleanForm.input.terms} />

          <Code block mt="xs">
            {`t.boolean({ title: "Subscribe" })`}
          </Code>
        </Stack>
      </Paper>

      {/* Password Inputs */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Password Inputs
        </Title>
        <Text c="dimmed" mb="lg">
          Auto-detected from field name containing "password"
        </Text>

        <Stack gap="md">
          <Control input={passwordForm.input.password} />
          <Control input={passwordForm.input.confirmPassword} />

          <Code block mt="xs">
            {`t.text({ title: "Password" }) // Auto-detected!`}
          </Code>
        </Stack>
      </Paper>

      {/* Textarea */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Textarea
        </Title>
        <Text c="dimmed" mb="lg">
          Use the <Code>area</Code> prop for multi-line text
        </Text>

        <Control input={textareaForm.input.bio} area />

        <Code block mt="md">
          {`<Control input={form.input.bio} area />`}
        </Code>
      </Paper>

      {/* Color Input */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Color Input
        </Title>
        <Text c="dimmed" mb="lg">
          Auto-detected from format: "color"
        </Text>

        <Control input={colorForm.input.themeColor} />

        <Code block mt="md">
          {`t.text({ format: "color" })`}
        </Code>
      </Paper>

      {/* Select */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Select (Enum)
        </Title>
        <Text c="dimmed" mb="lg">
          Auto-detected from enum schema
        </Text>

        <Control input={selectForm.input.role} />

        <Code block mt="md">
          {`t.enum(["admin", "user", "guest"])`}
        </Code>
      </Paper>

      {/* Segmented Control */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Segmented Control
        </Title>
        <Text c="dimmed" mb="lg">
          Use <Code>segmented</Code> prop for enum types
        </Text>

        <Control
          input={segmentedForm.input.status}
          select={{ segmented: true }}
        />

        <Code block mt="md">
          {`<Control input={form.input.status} segmented />`}
        </Code>
      </Paper>

      {/* Icons */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Automatic Icons
        </Title>
        <Text c="dimmed" mb="lg">
          All inputs automatically get contextual icons based on type, format,
          or name
        </Text>

        <Stack gap="md">
          <Control input={iconsForm.input.email} />
          <Control input={iconsForm.input.password} />
          <Control input={iconsForm.input.phone} />

          <Text c="dimmed" size="sm" mt="md">
            Icons can be overridden with custom icons:
          </Text>

          <Control
            input={iconsForm.input.username}
            icon={<IconRocket size={16} />}
          />

          <Code block mt="xs">
            {`<Control input={form.input.username} icon={<IconRocket />} />`}
          </Code>
        </Stack>
      </Paper>

      {/* Custom Props */}
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="md">
          Custom Props Override
        </Title>
        <Text c="dimmed" mb="lg">
          All Mantine component props can be passed
        </Text>

        <Stack gap="md">
          <Control
            input={customPropsForm.input.username}
            text={{ placeholder: "Custom placeholder", variant: "filled" }}
          />

          <Control
            input={customPropsForm.input.bio}
            area={{ minRows: 6, maxRows: 10, autosize: true }}
          />

          <Code block mt="md">
            {`<Control input={form.input.username} text={{ placeholder: "...", variant: "filled" }} />`}
          </Code>
        </Stack>
      </Paper>

      {/* Submit */}
      <Paper shadow="xs" p="xl" withBorder>
        <Stack gap="md">
          <Control input={submitForm.input.name} />
          <Control input={submitForm.input.email} />
          <Button
            type="submit"
            size="lg"
            fullWidth
            onClick={submitForm.props.onSubmit}
          >
            Submit Form
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
};

export default ExampleControl;
