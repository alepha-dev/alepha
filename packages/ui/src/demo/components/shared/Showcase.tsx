import { TypeForm, ui } from "@alepha/ui";
import { Card, Flex, Text } from "@mantine/core";
import type { Static, TObject } from "alepha";
import { useForm } from "alepha/react/form";
import { type ReactNode, useState } from "react";
import MacWindow, { type MacWindowProps } from "./MacWindow.tsx";

export interface ShowcaseProps<T extends TObject> {
  /**
   * Component title
   */
  title: string;
  /**
   * Schema for the props configuration
   */
  schema: T;
  /**
   * Initial values for the props
   */
  initialValues?: Partial<Static<T>>;
  /**
   * Number of columns for the props form
   */
  columns?: number;
  /**
   * Render function that receives the current props values
   */
  children: (props: Static<T>) => ReactNode;
  /**
   * Additional props for the MacWindow container
   */
  windowProps?: Partial<MacWindowProps>;
}

/**
 * Showcase component for demonstrating UI components with interactive props configuration.
 * Uses TypeForm to render a form based on the props schema and displays the component preview.
 */
const Showcase = <T extends TObject>({
  title,
  schema,
  initialValues,
  columns = 3,
  children,
  windowProps,
}: ShowcaseProps<T>) => {
  const [values, setValues] = useState<Record<string, any>>(
    initialValues ?? {},
  );

  const form = useForm(
    {
      schema,
      initialValues,
      handler: (values) => {
        setValues(values as Record<string, any>);
      },
      onChange: (key, value) => {
        return form.submit();
      },
    },
    [schema],
  );

  return (
    <Flex flex={1} px={"md"} gap={"md"}>
      <Flex
        flex={1}
        bg={ui.colors.background}
        h={"100%"}
        justify="center"
        align="flex-start"
        style={{ flex: 1, minWidth: 0, overflow: "auto" }}
      >
        <MacWindow title={title} {...windowProps}>
          {children(values as Static<T>)}
        </MacWindow>
      </Flex>

      <Flex
        h={"100%"}
        style={{
          flex: "0 0 300px",
          overflow: "auto",
        }}
      >
        <Card shadow="sm" radius="md">
          <Card.Section withBorder py={"xs"} inheritPadding>
            <Text size={"xs"} fw={500}>
              {title} Props
            </Text>
          </Card.Section>

          <Card.Section p={"sm"}>
            <TypeForm
              form={form}
              columns={{ base: 1, xs: 1, sm: 1, md: 1, lg: 1, xl: 1 }}
              skipSubmitButton
              skipFormElement
            />
          </Card.Section>
        </Card>
      </Flex>
    </Flex>
  );
};

export default Showcase;
