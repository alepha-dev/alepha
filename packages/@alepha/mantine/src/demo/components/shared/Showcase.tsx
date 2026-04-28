import { Flex, Text, TypeForm } from "@alepha/mantine";
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
const Showcase = <T extends TObject>(props: ShowcaseProps<T>) => {
  const {
    title,
    schema,
    initialValues,
    columns = 3,
    children,
    windowProps,
  } = props;

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
    <Flex fill p={"md"} pt={0} gap={"md"} overflow>
      <Flex fill overflow ground h={"100%"} justify="center" align="flex-start">
        <MacWindow title={title} {...windowProps}>
          {children(values as Static<T>)}
        </MacWindow>
      </Flex>

      <Flex h={"100%"} col surface bordered rounded shadowed w={300}>
        <Flex p={"xs"} borderedBottom>
          <Text size={"xs"} fw={500}>
            {title} Props
          </Text>
        </Flex>
        <Flex px={"md"} py={"xs"}>
          <TypeForm
            fill
            form={form}
            columns={{ base: 1, xs: 1, sm: 1, md: 1, lg: 1, xl: 1 }}
            skipSubmitButton
            skipFormElement
          />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default Showcase;
