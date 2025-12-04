import { useInject, useRouter, useStore } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { ActionButton, Control, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconCreditCard,
  IconLock,
  IconMail,
  IconShieldCheck,
  IconUser,
} from "@tabler/icons-react";
import { t } from "alepha";
import type { AppRouter } from "../../AppRouter.ts";
import { bookingAtom } from "../../atoms/bookingAtom.ts";
import { BookingService } from "../../services/BookingService.ts";

const Payment = () => {
  const router = useRouter<AppRouter>();
  const bookingService = useInject(BookingService);
  const [booking] = useStore(bookingAtom);

  const form = useForm({
    schema: t.object({
      firstName: t.string({ minLength: 1 }),
      lastName: t.string({ minLength: 1 }),
      email: t.email(),
      cardNumber: t.string({ minLength: 16, maxLength: 19 }),
      expiry: t.string({ minLength: 5, maxLength: 5 }),
      cvv: t.string({ minLength: 3, maxLength: 4 }),
    }),
    handler: async (data) => {
      // Simulate payment processing
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const bookingRef = bookingService.generateBookingReference();
      bookingService.updateBooking({
        step: "confirmation",
        passenger: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
        },
        bookingReference: bookingRef,
      });

      await router.go("bookingConfirmation");
    },
  });

  const requiredSeats = booking?.search?.passengers ?? 1;
  const basePrice = (booking?.selectedTrip?.price ?? 0) * requiredSeats;
  const seatPrice =
    booking?.selectedSeats?.reduce((sum, s) => sum + s.price, 0) ?? 0;
  const totalPrice = basePrice + seatPrice;

  if (!booking?.selectedTrip || !booking?.selectedSeats?.length) {
    return (
      <Container size="md" py="xl">
        <Card withBorder p="xl" ta="center">
          <Stack gap="md" align="center">
            <Text c="dimmed">No seats selected</Text>
            <ActionButton href={router.path("bookingSearch")}>
              Start New Search
            </ActionButton>
          </Stack>
        </Card>
      </Container>
    );
  }

  return (
    <Flex flex={1} direction="column">
      <Flex bg="var(--mantine-color-blue-6)" py="lg" px="xl">
        <Container size="lg" w="100%">
          <Group justify="space-between" align="center">
            <Group gap="lg">
              <ActionButton
                variant="subtle"
                c="white"
                leftSection={<IconArrowLeft size={18} />}
                href={router.path("bookingSeats")}
              >
                Back
              </ActionButton>
              <Divider orientation="vertical" color="blue.4" />
              <Group gap="xs">
                <IconLock size={18} color="white" />
                <Text c="white" fw={600}>
                  Secure Payment
                </Text>
              </Group>
            </Group>
            <Group gap="xs">
              <IconShieldCheck size={20} color="white" />
              <Text c="white" size="sm">
                256-bit SSL Encryption
              </Text>
            </Group>
          </Group>
        </Container>
      </Flex>

      <Container size="lg" py="xl">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="lg">
            <Title order={3}>Payment Details</Title>

            <form {...form.props}>
              <Stack gap="lg">
                <Card withBorder radius="md" p="lg">
                  <Stack gap="md">
                    <Group gap="xs">
                      <IconUser size={18} />
                      <Text fw={500}>Passenger Information</Text>
                    </Group>

                    <Group grow>
                      <Control
                        title="First Name"
                        input={form.input.firstName}
                        text={{ placeholder: "John" }}
                      />
                      <Control
                        title="Last Name"
                        input={form.input.lastName}
                        text={{ placeholder: "Doe" }}
                      />
                    </Group>

                    <Control
                      title="Email"
                      input={form.input.email}
                      text={{
                        placeholder: "john.doe@example.com",
                        leftSection: <IconMail size={16} />,
                      }}
                    />
                  </Stack>
                </Card>

                <Card withBorder radius="md" p="lg">
                  <Stack gap="md">
                    <Group gap="xs">
                      <IconCreditCard size={18} />
                      <Text fw={500}>Card Details</Text>
                    </Group>

                    <Control
                      title="Card Number"
                      input={form.input.cardNumber}
                      text={{
                        placeholder: "1234 5678 9012 3456",
                        leftSection: <IconCreditCard size={16} />,
                      }}
                    />

                    <Group grow>
                      <Control
                        title="Expiry Date"
                        input={form.input.expiry}
                        text={{ placeholder: "MM/YY" }}
                      />
                      <Control
                        title="CVV"
                        input={form.input.cvv}
                        text={{ placeholder: "123", type: "password" }}
                      />
                    </Group>

                    <Group gap="xs" c="dimmed">
                      <IconLock size={14} />
                      <Text size="xs">
                        Your payment information is encrypted and secure
                      </Text>
                    </Group>
                  </Stack>
                </Card>

                <ActionButton
                  form={form}
                  size="lg"
                  leftSection={<IconLock size={18} />}
                >
                  Pay €{totalPrice}
                </ActionButton>
              </Stack>
            </form>
          </Stack>

          <Stack gap="lg">
            <Title order={3}>Order Summary</Title>

            <Card withBorder radius="md" p="lg">
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={500}>Journey Details</Text>
                  <Badge variant="light">
                    {booking.selectedTrip.trainType}
                  </Badge>
                </Group>

                <Divider />

                <Group justify="space-between">
                  <Text c="dimmed">Route</Text>
                  <Text fw={500}>
                    {booking.search?.from} → {booking.search?.to}
                  </Text>
                </Group>

                <Group justify="space-between">
                  <Text c="dimmed">Date</Text>
                  <Text fw={500}>{booking.search?.date}</Text>
                </Group>

                <Group justify="space-between">
                  <Text c="dimmed">Train</Text>
                  <Text fw={500}>{booking.selectedTrip.trainNumber}</Text>
                </Group>

                <Group justify="space-between">
                  <Text c="dimmed">Departure</Text>
                  <Text fw={500}>{booking.selectedTrip.departureTime}</Text>
                </Group>

                <Group justify="space-between">
                  <Text c="dimmed">Arrival</Text>
                  <Text fw={500}>{booking.selectedTrip.arrivalTime}</Text>
                </Group>

                <Divider />

                <Text fw={500}>Selected Seats</Text>
                {booking.selectedSeats.map((seat) => (
                  <Group key={seat.id} justify="space-between">
                    <Text size="sm" c="dimmed">
                      Seat {seat.number} ({seat.class} class)
                    </Text>
                    <Text size="sm">
                      {seat.price > 0 ? `+€${seat.price}` : "Included"}
                    </Text>
                  </Group>
                ))}

                <Divider />

                <Group justify="space-between">
                  <Text c="dimmed">Base fare ({requiredSeats} passengers)</Text>
                  <Text>€{basePrice}</Text>
                </Group>

                {seatPrice > 0 && (
                  <Group justify="space-between">
                    <Text c="dimmed">Seat selection</Text>
                    <Text>€{seatPrice}</Text>
                  </Group>
                )}

                <Divider />

                <Group justify="space-between">
                  <Text fw={600} size="lg">
                    Total
                  </Text>
                  <Text fw={700} size="xl" c="blue">
                    €{totalPrice}
                  </Text>
                </Group>
              </Stack>
            </Card>

            <Card
              withBorder
              radius="md"
              p="md"
              bg="var(--mantine-color-gray-0)"
            >
              <Group gap="xs">
                <IconShieldCheck
                  size={20}
                  color="var(--mantine-color-green-6)"
                />
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    Free cancellation
                  </Text>
                  <Text size="xs" c="dimmed">
                    Cancel up to 24 hours before departure
                  </Text>
                </Stack>
              </Group>
            </Card>
          </Stack>
        </SimpleGrid>
      </Container>
    </Flex>
  );
};

export default Payment;
