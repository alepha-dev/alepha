import { Flex, Text } from "@mantine/core";
import type { ReactNode } from "react";

export interface ProfileFieldProps {
  /**
   * Icon to display
   */
  icon: ReactNode;

  /**
   * Field label
   */
  label: string;

  /**
   * Field content
   */
  children: ReactNode;
}

const ProfileField = (props: ProfileFieldProps) => {
  const { icon, label, children } = props;

  return (
    <Flex gap="sm" align="flex-start">
      <Flex c="dimmed" mt={2}>
        {icon}
      </Flex>
      <Flex direction="column" gap={2} flex={1}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
          {label}
        </Text>
        <Text size="sm" component="span">{children}</Text>
      </Flex>
    </Flex>
  );
};

export default ProfileField;
