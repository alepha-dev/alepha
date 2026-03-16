import { Flex, Text } from "@alepha/ui";

export type FooterProps = {};

export const Footer = (props: FooterProps) => {
  return (
    <Flex justify="center" p="xl">
      <Text size="xs" c="dimmed">
        Built with Alepha
      </Text>
    </Flex>
  );
};
