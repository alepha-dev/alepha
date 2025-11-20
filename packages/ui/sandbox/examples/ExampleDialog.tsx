import {
  Button,
  Card,
  Code,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { useDialog } from "../../src/core/hooks/useDialog.ts";

export default function ExampleDialog() {
  const dialog = useDialog();
  const [modalId, setModalId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Alert, Confirm, Prompt examples
  const handleAlert = async () => {
    await dialog.alert({
      title: "Information",
      message: "This is an alert dialog. Click OK to dismiss.",
    });
    setLastResult("Alert closed");
  };

  const handleConfirm = async () => {
    const confirmed = await dialog.confirm({
      title: "Confirm Action",
      message: "Are you sure you want to proceed with this action?",
      confirmLabel: "Yes, proceed",
      cancelLabel: "No, cancel",
    });
    setLastResult(`Confirm result: ${confirmed}`);
  };

  const handleConfirmDanger = async () => {
    const confirmed = await dialog.confirm({
      title: "Delete Item",
      message:
        "This action cannot be undone. Are you sure you want to delete this item?",
      confirmLabel: "Delete",
      cancelLabel: "Keep",
      confirmColor: "red",
    });
    setLastResult(`Delete confirmed: ${confirmed}`);
  };

  const handlePrompt = async () => {
    const value = await dialog.prompt({
      title: "Enter Your Name",
      message: "Please provide your name for personalization.",
      placeholder: "John Doe",
      label: "Name",
    });
    setLastResult(value ? `Hello, ${value}!` : "Prompt cancelled");
  };

  const handlePromptRequired = async () => {
    const value = await dialog.prompt({
      title: "Required Input",
      message: "This field is required and cannot be empty.",
      placeholder: "Enter value...",
      label: "Required Field",
      required: true,
      submitLabel: "Submit",
    });
    setLastResult(value ? `Received: "${value}"` : "Cancelled");
  };

  const handlePromptWithDefault = async () => {
    const value = await dialog.prompt({
      title: "Edit Value",
      message: "Modify the existing value below:",
      defaultValue: "Default text here",
      label: "Value",
    });
    setLastResult(value !== null ? `Updated to: "${value}"` : "No changes");
  };

  const handleOpenSimple = () => {
    const id = dialog.open({
      title: "Simple Dialog",
      content: <Text>This is a simple dialog with some content.</Text>,
    });
    setModalId(id);
  };

  const handleOpenComplex = () => {
    const id = dialog.open({
      title: "Complex Dialog Example",
      size: "lg",
      content: (
        <Stack>
          <Text>This is a more complex dialog with interactive content.</Text>
          <TextInput
            label="Enter your name"
            placeholder="John Doe"
            value={inputValue}
            onChange={(e) => setInputValue(e.currentTarget.value)}
          />
          <Card withBorder>
            <Text size="sm">
              This dialog demonstrates that you can include any React component
              as content.
            </Text>
          </Card>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => dialog.close(id)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                console.log("Submitted value:", inputValue);
                dialog.close(id);
              }}
            >
              Submit
            </Button>
          </Group>
        </Stack>
      ),
    });
    setModalId(id);
  };

  const handleOpenCustomSize = () => {
    const id = dialog.open({
      title: "Full Width Dialog",
      size: "xl",
      fullScreen: false,
      content: (
        <Stack>
          <Text>This dialog uses a custom size (xl).</Text>
          <Text size="sm" c="dimmed">
            You can customize many properties like size, position, overlay, etc.
          </Text>
        </Stack>
      ),
    });
    setModalId(id);
  };

  const handleOpenNoBlur = () => {
    const id = dialog.open({
      title: "No Blur Dialog",
      overlayProps: {
        blur: 0,
        backgroundOpacity: 0.35,
      },
      content: (
        <Stack>
          <Text>This dialog has a regular overlay without blur effect.</Text>
          <Button onClick={() => dialog.close(id)} fullWidth>
            Close Dialog
          </Button>
        </Stack>
      ),
    });
    setModalId(id);
  };

  const handleOpenCustomAnimation = () => {
    const id = dialog.open({
      title: "Custom Animation",
      transitionProps: {
        transition: "fade",
        duration: 400,
      },
      content: (
        <Stack>
          <Text>This dialog uses a fade animation instead of scale.</Text>
          <Text size="sm" c="dimmed">
            You can choose from: pop, fade, rotate, slide, or create custom
            animations.
          </Text>
          <Button onClick={() => dialog.close(id)} variant="light">
            Close
          </Button>
        </Stack>
      ),
    });
    setModalId(id);
  };

  return (
    <Stack>
      <Text size="lg" fw={600}>
        Dialog Service Examples
      </Text>

      <Stack gap="md">
        <div>
          <Text size="sm" fw={500} mb="xs">
            Basic Dialogs
          </Text>
          <Group>
            <Button onClick={handleAlert} variant="default">
              Alert
            </Button>
            <Button onClick={handleConfirm} variant="default">
              Confirm
            </Button>
            <Button onClick={handleConfirmDanger} color="red" variant="light">
              Confirm (Danger)
            </Button>
          </Group>
        </div>

        <div>
          <Text size="sm" fw={500} mb="xs">
            Prompt Dialogs
          </Text>
          <Group>
            <Button onClick={handlePrompt} variant="default">
              Prompt
            </Button>
            <Button onClick={handlePromptRequired} variant="default">
              Required Prompt
            </Button>
            <Button onClick={handlePromptWithDefault} variant="default">
              Prompt with Default
            </Button>
          </Group>
        </div>

        <div>
          <Text size="sm" fw={500} mb="xs">
            Custom Dialogs
          </Text>
          <Group>
            <Button onClick={handleOpenSimple}>Simple Dialog</Button>
            <Button onClick={handleOpenComplex} variant="filled">
              Complex Dialog
            </Button>
            <Button onClick={handleOpenCustomSize} variant="outline">
              XL Size Dialog
            </Button>
            <Button onClick={handleOpenNoBlur} variant="subtle">
              Without Blur
            </Button>
            <Button onClick={handleOpenCustomAnimation} variant="light">
              Custom Animation
            </Button>
          </Group>
        </div>
      </Stack>

      <Group>
        <Button
          onClick={() => dialog.close(modalId || "")}
          disabled={!modalId}
          color="red"
          variant="light"
        >
          Close Specific Dialog
        </Button>
        <Button onClick={() => dialog.close()} color="red" variant="outline">
          Close All Dialogs
        </Button>
      </Group>

      {modalId && (
        <Text size="sm" c="dimmed">
          Current modal ID: {modalId}
        </Text>
      )}

      {lastResult && (
        <Card withBorder p="sm">
          <Group gap="xs">
            <Text size="sm" fw={500}>
              Last Result:
            </Text>
            <Code>{lastResult}</Code>
          </Group>
        </Card>
      )}
    </Stack>
  );
}
