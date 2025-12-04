import {
  Box,
  Container,
  Flex,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconBrandApple,
  IconBrandGoogle,
  IconBrandMastercard,
  IconBrandPaypal,
  IconBrandVisa,
  IconLock,
  IconShieldCheck,
} from "@tabler/icons-react";
import { motion } from "framer-motion";

const paymentMethods = [
  { icon: IconBrandVisa, label: "Visa" },
  { icon: IconBrandMastercard, label: "Mastercard" },
  { icon: IconBrandPaypal, label: "PayPal" },
  { icon: IconBrandApple, label: "Apple Pay" },
  { icon: IconBrandGoogle, label: "Google Pay" },
];

export const PaymentMethods = () => {
  return (
    <Box py={40} style={{ borderTop: "1px solid var(--alepha-border)" }}>
      <Container size="lg">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Stack gap="lg" align="center">
            <Text size="sm" c="dimmed">
              Secure payments
            </Text>
            <Group gap="xl">
              {paymentMethods.map((payment) => (
                <Tooltip key={payment.label} label={payment.label}>
                  <motion.div whileHover={{ scale: 1.1 }}>
                    <Flex
                      w={48}
                      h={32}
                      align="center"
                      justify="center"
                      bg="var(--alepha-surface)"
                      style={{ borderRadius: 6 }}
                    >
                      <payment.icon
                        size={20}
                        color="var(--alepha-text-muted)"
                      />
                    </Flex>
                  </motion.div>
                </Tooltip>
              ))}
            </Group>
            <Group gap="xl">
              <Group gap={4}>
                <IconShieldCheck
                  size={14}
                  color="var(--mantine-color-green-6)"
                />
                <Text size="xs" c="dimmed">
                  256-bit SSL
                </Text>
              </Group>
              <Group gap={4}>
                <IconLock size={14} color="var(--alepha-text-muted)" />
                <Text size="xs" c="dimmed">
                  PCI DSS Compliant
                </Text>
              </Group>
            </Group>
          </Stack>
        </motion.div>
      </Container>
    </Box>
  );
};
