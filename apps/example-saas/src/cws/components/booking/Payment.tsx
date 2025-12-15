import { useClient, useInject, useRouter, useStore } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { ActionButton, Control, Text } from "@alepha/ui";
import { Alert, Box, Card, Group, Loader, Stack, Title } from "@mantine/core";
import { useColorScheme } from "@mantine/hooks";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import {
  loadStripe,
  type Stripe,
  type StripeElementsOptions,
} from "@stripe/stripe-js";
import {
  IconAlertCircle,
  IconCreditCard,
  IconLock,
  IconMail,
  IconUser,
} from "@tabler/icons-react";
import { AlephaError, t } from "alepha";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookingController } from "../../../api/bookings/controllers/BookingController.ts";
import type { PaymentController } from "../../../api/payments/controllers/PaymentController.ts";
import { type BookingState, bookingAtom } from "../../atoms/bookingAtom.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { BookingService } from "../../services/BookingService.ts";

/**
 * Inner payment form component that uses Stripe hooks.
 * Must be wrapped in Elements provider.
 */
const PaymentForm = ({
  booking,
  basePrice,
  seatPrice,
  totalPrice,
  requiredSeats,
  fareClassPrice,
  onSuccess,
}: {
  booking: BookingState;
  basePrice: number;
  seatPrice: number;
  totalPrice: number;
  requiredSeats: number;
  fareClassPrice: number;
  onSuccess: (reference: string) => void;
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const bookingService = useInject(BookingService);
  const bookingClient = useClient<BookingController>();
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const form = useForm(
    {
      schema: t.object({
        firstName: t.string({ minLength: 1 }),
        lastName: t.string({ minLength: 1 }),
        email: t.email(),
      }),
      handler: async (data) => {
        if (!elements) {
          throw new AlephaError("Stripe not loaded - missing elements");
        }
        if (!stripe) {
          throw new AlephaError("Stripe not loaded - missing stripe instance");
        }

        if (
          !booking?.selectedTrip ||
          !booking?.search ||
          !booking?.selectedSeats
        ) {
          throw new AlephaError("Missing booking data");
        }

        setPaymentError(null);
        setIsProcessing(true);

        try {
          // 1. Create the booking in the database first
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
              // Yield management fields
              tripInstanceId: booking.tripInstanceId,
              fareClassId: booking.selectedFareClass?.id,
              fareClassName: booking.selectedFareClass?.name,
              lockedBasePrice: booking.selectedFareClass?.price,
              priceMultiplierApplied: booking.dynamicMultiplier,
              priceCalculatedAt: booking.priceValidUntil
                ? new Date().toISOString()
                : undefined,
            },
          });

          // 2. Confirm the payment with Stripe
          const { error } = await stripe.confirmPayment({
            elements,
            confirmParams: {
              return_url: `${window.location.origin}/booking/confirmation?reference=${createdBooking.reference}`,
              receipt_email: data.email,
            },
            redirect: "if_required",
          });

          if (error) {
            // Payment failed - show error
            if (
              error.type === "card_error" ||
              error.type === "validation_error"
            ) {
              setPaymentError(error.message ?? "Payment failed");
            } else {
              setPaymentError("An unexpected error occurred");
            }
            return;
          }

          // 3. Payment succeeded - update local state
          bookingService.updateBooking({
            step: "confirmation",
            passenger: {
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
            },
            bookingReference: createdBooking.reference,
          });

          onSuccess(createdBooking.reference);
        } finally {
          setIsProcessing(false);
        }
      },
    },
    [stripe, elements],
  );

  return (
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
            <Group gap="xs">
              <IconCreditCard size={18} />
              <Text fw={500}>Card Details</Text>
            </Group>

            <Box
              p="md"
              style={{
                border: "1px solid var(--alepha-border)",
                borderRadius: "var(--mantine-radius-md)",
                backgroundColor: "var(--alepha-background)",
              }}
            >
              <PaymentElement
                options={{
                  layout: "tabs",
                }}
              />
            </Box>

            {paymentError && (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="red"
                variant="light"
              >
                {paymentError}
              </Alert>
            )}

            <Group gap="xs" c="dimmed">
              <IconLock size={14} />
              <Text size="xs">
                Your payment is processed securely by Stripe
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
          loading={isProcessing}
          disabled={!stripe || !elements}
        >
          {isProcessing
            ? "Processing..."
            : `Pay €${(totalPrice / 100).toFixed(2)}`}
        </ActionButton>
      </Stack>
    </form>
  );
};

/**
 * Payment page with Stripe Elements integration.
 */
const Payment = () => {
  const router = useRouter<CwsRouter>();
  const paymentClient = useClient<PaymentController>();
  const [booking] = useStore(bookingAtom);

  // Stripe state
  const [stripePromise, setStripePromise] =
    useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingStripe, setLoadingStripe] = useState(true);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const requiredSeats = booking?.search?.passengers ?? 1;
  // Use locked fare class price if available, otherwise fall back to trip price
  const fareClassPrice =
    booking?.selectedFareClass?.price ?? booking?.selectedTrip?.price ?? 0;
  const basePrice = fareClassPrice * requiredSeats;
  const seatPrice =
    booking?.selectedSeats?.reduce((sum, s) => sum + s.price, 0) ?? 0;
  // Add-ons total (already in cents from bookingAtom)
  const addOnsTotal = Math.round((booking?.addOnsTotal ?? 0) * 100);
  const totalPrice = basePrice + seatPrice + addOnsTotal;

  // Initialize Stripe on mount
  useEffect(() => {
    const initStripe = async () => {
      if (!booking?.selectedTrip || totalPrice <= 0) return;

      try {
        // Get Stripe publishable key
        const { publishableKey } = await paymentClient.getStripeConfig({});

        setStripePromise(loadStripe(publishableKey));

        // Create Payment Intent
        const { clientSecret } = await paymentClient.createPaymentIntent({
          body: {
            bookingId: crypto.randomUUID(), // Temporary ID, will be replaced
            bookingReference: `TEMP-${Date.now()}`,
            amount: totalPrice,
            currency: "EUR",
            customerEmail: "customer@example.com", // Will be updated on form submit
            description: `Train: ${booking.selectedTrip.trainNumber} - ${booking.search?.from} to ${booking.search?.to}`,
          },
        });

        setClientSecret(clientSecret);
      } catch (error) {
        console.error(error);
        setStripeError(
          error instanceof Error
            ? error.message
            : "Failed to initialize payment",
        );
      } finally {
        setLoadingStripe(false);
      }
    };

    initStripe();
  }, []);

  const handlePaymentSuccess = useCallback(
    async (reference: string) => {
      await router.go("bookingConfirmation");
    },
    [router],
  );

  const colorSchema = useColorScheme();

  // Stripe Elements options
  const elementsOptions: StripeElementsOptions | undefined = useMemo(() => {
    if (!clientSecret) return undefined;
    return {
      clientSecret,
      appearance:
        colorSchema === "dark"
          ? {
              theme: "night",
              labels: "floating",
            }
          : {
              theme: "stripe",
            },
    };
  }, [clientSecret]);

  if (!booking?.selectedTrip || !booking?.selectedSeats?.length) {
    return (
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
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Title order={3}>Complete Your Booking</Title>
        <Group gap="xs">
          <IconLock size={16} color="var(--mantine-color-green-6)" />
          <Text size="sm" c="dimmed">
            Secure payment powered by Stripe
          </Text>
        </Group>
      </Group>

      {loadingStripe ? (
        <Card
          withBorder
          radius="md"
          p="xl"
          bg="var(--alepha-elevated)"
          bd="1px solid var(--alepha-border)"
        >
          <Stack align="center" gap="md">
            <Loader size="lg" />
            <Text c="dimmed">Initializing secure payment...</Text>
          </Stack>
        </Card>
      ) : stripeError ? (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Payment Error"
        >
          {stripeError}
        </Alert>
      ) : stripePromise && clientSecret && elementsOptions ? (
        <Elements stripe={stripePromise} options={elementsOptions}>
          <PaymentForm
            booking={booking}
            basePrice={basePrice}
            seatPrice={seatPrice}
            totalPrice={totalPrice}
            requiredSeats={requiredSeats}
            fareClassPrice={fareClassPrice}
            onSuccess={handlePaymentSuccess}
          />
        </Elements>
      ) : null}
    </Stack>
  );
};

export default Payment;
