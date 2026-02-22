import { ActionButton, Flex } from "@alepha/ui";
import {
  IconCheck,
  IconDownload,
  IconPlus,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const showcaseSchema = t.object({
  variant: t.enum(
    ["filled", "light", "outline", "subtle", "default", "transparent"],
    {
      title: "variant",
      default: "filled",
    },
  ),
  size: t.enum(["xs", "sm", "md", "lg", "xl"], {
    title: "size",
    default: "md",
  }),
  intent: t.enum(["none", "primary", "success", "danger", "warning", "info"], {
    title: "intent",
    default: "none",
  }),
  disabled: t.boolean({
    title: "disabled",
    default: false,
    $control: { switch: true },
  }),
  loading: t.boolean({
    title: "loading",
    default: false,
    $control: { switch: true },
  }),
});

const DemoActionButton = () => {
  return (
    <Showcase
      title="ActionButton"
      schema={showcaseSchema}
      initialValues={{
        variant: "filled",
        size: "md",
        intent: "none",
        disabled: false,
        loading: false,
      }}
      columns={1}
    >
      {(props) => (
        <Flex col gap="xl" p="md">
          <Flex gap="md" wrap="wrap" centerY>
            <ActionButton
              variant={props.variant}
              size={props.size}
              intent={props.intent}
              disabled={props.disabled}
              loading={props.loading}
              onClick={() => alert("Clicked")}
            >
              Default
            </ActionButton>
            <ActionButton
              variant={props.variant}
              size={props.size}
              intent={props.intent}
              disabled={props.disabled}
              loading={props.loading}
              icon={IconPlus}
              onClick={() => alert("Create")}
            >
              Create
            </ActionButton>
            <ActionButton
              variant={props.variant}
              size={props.size}
              intent={props.intent}
              disabled={props.disabled}
              loading={props.loading}
              icon={IconTrash}
              onClick={() => alert("Delete")}
            />
          </Flex>

          <Flex gap="md" wrap="wrap" centerY>
            <ActionButton
              variant="filled"
              size={props.size}
              intent="primary"
              icon={IconCheck}
              onClick={() => {}}
            >
              Save
            </ActionButton>
            <ActionButton
              variant="filled"
              size={props.size}
              intent="danger"
              icon={IconTrash}
              confirm="Are you sure?"
              onClick={() => alert("Deleted")}
            >
              Delete
            </ActionButton>
            <ActionButton
              variant="light"
              size={props.size}
              icon={IconDownload}
              onClick={() => {}}
            >
              Export
            </ActionButton>
            <ActionButton
              variant="subtle"
              size={props.size}
              icon={IconSettings}
              onClick={() => {}}
            />
          </Flex>

          <Flex gap="md" wrap="wrap" centerY>
            <ActionButton
              variant={props.variant}
              size={props.size}
              menu={{
                items: [
                  { label: "Edit", icon: <IconSettings size={14} /> },
                  { type: "divider" },
                  {
                    label: "Delete",
                    icon: <IconTrash size={14} />,
                    color: "red",
                  },
                ],
              }}
              onClick={() => {}}
            >
              With Menu
            </ActionButton>
            <ActionButton
              variant={props.variant}
              size={props.size}
              tooltip="This button has a tooltip"
              icon={IconSettings}
              onClick={() => {}}
            >
              With Tooltip
            </ActionButton>
          </Flex>
        </Flex>
      )}
    </Showcase>
  );
};

export default DemoActionButton;
