import { useClient, useInject, useRouter, useStore } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { ActionButton, Control, Flex, Text } from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconCreditCard,
  IconLock,
  IconMail,
  IconShieldCheck,
  IconUser,
  IconWand,
} from "@tabler/icons-react";
import { t } from "alepha";
import type { BookingController } from "../../../api/controllers/BookingController.ts";
import type { PaymentController } from "../../../api/controllers/PaymentController.ts";
import { BookingService } from "../../../api/services/BookingService.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { bookingAtom } from "../../atoms/bookingAtom.ts";

const Payment = () => {
  const router = useRouter<AppRouter>();
  const bookingService = useInject(BookingService);
  const bookingClient = useClient<BookingController>();
  const paymentClient = useClient<PaymentController>();
  const [booking] = useStore(bookingAtom);

  const requiredSeats = booking?.search?.passengers ?? 1;
  const basePrice = (booking?.selectedTrip?.price ?? 0) * requiredSeats;
  const seatPrice =
    booking?.selectedSeats?.reduce((sum, s) => sum + s.price, 0) ?? 0;
  const totalPrice = basePrice + seatPrice;

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
      if (
        !booking?.selectedTrip ||
        !booking?.search ||
        !booking?.selectedSeats
      ) {
        throw new Error("Missing booking data");
      }

      // 1. Create the booking in the database
      const createdBooking = await bookingClient.createBooking({
        body: {
          departureStation: booking.search.from,
          arrivalStation: booking.search.to,
          departureTime: booking.selectedTrip.departureTime,
          arrivalTime: booking.selectedTrip.arrivalTime,
          travelDate: booking.search.date,
          trainNumber: booking.selectedTrip.trainNumber,
          trainType: booking.selectedTrip.trainType,
          passengerFirstName: data.firstName,
          passengerLastName: data.lastName,
          passengerEmail: data.email,
          seats: booking.selectedSeats.map((seat) => ({
            number: seat.number,
            class: seat.class,
            price: seat.price,
          })),
          baseFare: basePrice,
          seatUpgrades: seatPrice,
          totalPrice: totalPrice,
          passengerCount: requiredSeats,
        },
      });

      // 2. Create the payment record
      await paymentClient.createPayment({
        body: {
          bookingId: createdBooking.id,
          bookingReference: createdBooking.reference,
          amount: totalPrice,
          currency: "CAD",
          method: "card",
          cardLast4: data.cardNumber.slice(-4),
          cardBrand: "Visa", // In real app, detect from card number
          payerEmail: data.email,
        },
      });

      // 3. Update local state with booking reference
      bookingService.updateBooking({
        step: "confirmation",
        passenger: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
        },
        bookingReference: createdBooking.reference,
      });

      await router.go("bookingConfirmation");
    },
  });

  const prefillTestData = () => {
    form.input.cardNumber.set("4242424242424242");
    form.input.expiry.set("12/28");
    form.input.cvv.set("123");
  };

  if (!booking?.selectedTrip || !booking?.selectedSeats?.length) {
    return (
      <Container size="md" py="xl">
        <Card
          withBorder
          p="xl"
          ta="center"
          bg="var(--alepha-elevated)"
          bd="1px solid var(--alepha-border)"
        >
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
    <Flex flex={1} direction="column" bg="var(--alepha-background)">
      {/* Header with grid pattern */}
      <Box bg="dark.9" pos="relative" style={{ overflow: "hidden" }}>
        <Box
          pos="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
            `,
            backgroundSize: "64px 64px",
          }}
        />
        <Container size="lg" py="lg" pos="relative">
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
              <Divider orientation="vertical" color="dark.5" />
              <Group gap="xs">
                <IconLock size={18} color="white" />
                <Text c="white" fw={600}>
                  Secure Payment
                </Text>
              </Group>
            </Group>
            <Group gap="xs">
              <IconShieldCheck size={20} color="white" />
              <Text c="dark.3" size="sm">
                256-bit SSL Encryption
              </Text>
            </Group>
          </Group>
        </Container>
      </Box>

      <Container size="lg" py="xl">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="lg">
            <Title order={3}>Payment Details</Title>

            <form {...form.props}>
              <Stack gap="lg">
                <Card
                  withBorder
                  radius="md"
                  p="lg"
                  bg="var(--alepha-elevated)"
                  bd="1px solid var(--alepha-border)"
                >
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

                <Card
                  withBorder
                  radius="md"
                  p="lg"
                  bg="var(--alepha-elevated)"
                  bd="1px solid var(--alepha-border)"
                >
                  <Stack gap="md">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <IconCreditCard size={18} />
                        <Text fw={500}>Card Details</Text>
                      </Group>
                      <Tooltip label="Fill with test data">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          onClick={prefillTestData}
                        >
                          <IconWand size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>

                    <Control
                      title="Card Number"
                      input={{
                        ...form.input.cardNumber,
                        props: {
                          ...form.input.cardNumber.props,
                          name: "cardnumber",
                          autoComplete: "cc-number",
                        },
                      }}
                      text={{
                        placeholder: "1234 5678 9012 3456",
                        leftSection: <IconCreditCard size={16} />,
                      }}
                    />

                    <Group grow>
                      <Control
                        title="Expiry Date"
                        input={{
                          ...form.input.expiry,
                          props: {
                            ...form.input.expiry.props,
                            name: "exp-date",
                            autoComplete: "cc-exp",
                          },
                        }}
                        text={{ placeholder: "MM/YY" }}
                      />
                      <Control
                        title="CVV"
                        input={{
                          ...form.input.cvv,
                          props: {
                            ...form.input.cvv.props,
                            name: "cvc",
                            autoComplete: "cc-csc",
                          },
                        }}
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
                  variant="filled"
                  color="green"
                  form={form}
                  size="lg"
                  leftSection={<IconLock size={18} />}
                >
                  Pay ${totalPrice} CAD
                </ActionButton>
              </Stack>
            </form>
          </Stack>

          <Stack gap="lg">
            <Title order={3}>Order Summary</Title>

            <Card
              withBorder
              radius="md"
              p="lg"
              bg="var(--alepha-elevated)"
              bd="1px solid var(--alepha-border)"
            >
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={500}>Journey Details</Text>
                  <Badge variant="light" color="dark">
                    {booking.selectedTrip.trainType}
                  </Badge>
                </Group>

                <Divider color="var(--alepha-border)" />

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

                <Divider color="var(--alepha-border)" />

                <Text fw={500}>Selected Seats</Text>
                {booking.selectedSeats.map((seat) => (
                  <Group key={seat.id} justify="space-between">
                    <Text size="sm" c="dimmed">
                      Seat {seat.number} ({seat.class} class)
                    </Text>
                    <Text size="sm">
                      {seat.price > 0 ? `+$${seat.price}` : "Included"}
                    </Text>
                  </Group>
                ))}

                <Divider color="var(--alepha-border)" />

                <Group justify="space-between">
                  <Text c="dimmed">Base fare ({requiredSeats} passengers)</Text>
                  <Text>${basePrice}</Text>
                </Group>

                {seatPrice > 0 && (
                  <Group justify="space-between">
                    <Text c="dimmed">Seat selection</Text>
                    <Text>${seatPrice}</Text>
                  </Group>
                )}

                <Divider color="var(--alepha-border)" />

                <Group justify="space-between">
                  <Text fw={600} size="lg">
                    Total
                  </Text>
                  <Text fw={700} size="xl">
                    ${totalPrice} CAD
                  </Text>
                </Group>
              </Stack>
            </Card>

            <Card
              withBorder
              radius="md"
              p="md"
              bg="var(--alepha-elevated)"
              bd="1px solid var(--alepha-border)"
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
