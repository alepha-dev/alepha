import { NestedView, useRouter, useRouterState, useStore } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Box,
  Container,
  Divider,
  Group,
  Paper,
  Stepper,
} from "@mantine/core";
import {
  IconArmchair,
  IconArrowLeft,
  IconCheck,
  IconCreditCard,
  IconGift,
  IconListSearch,
  IconTicket,
  IconTrain,
} from "@tabler/icons-react";
import { bookingAtom } from "../../atoms/bookingAtom.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { BookingSummary } from "./BookingSummary.tsx";

/**
 * Step configuration for the booking wizard
 */
const STEPS = [
  {
    key: "results",
    label: "Select Train",
    description: "Choose your journey",
    icon: IconListSearch,
    path: "bookingResults",
  },
  {
    key: "fareclass",
    label: "Fare Class",
    description: "Pick your fare",
    icon: IconTicket,
    path: "bookingFareClass",
  },
  {
    key: "seats",
    label: "Seats",
    description: "Choose seats",
    icon: IconArmchair,
    path: "bookingSeats",
  },
  {
    key: "addons",
    label: "Add-ons",
    description: "Extras & services",
    icon: IconGift,
    path: "bookingAddOns",
  },
  {
    key: "payment",
    label: "Payment",
    description: "Complete booking",
    icon: IconCreditCard,
    path: "bookingPayment",
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

/**
 * Map pathname endings to step indices
 */
const getStepFromPath = (pathname: string): number => {
  if (pathname.includes("/results")) return 0;
  if (pathname.includes("/fareclass")) return 1;
  if (pathname.includes("/seats")) return 2;
  if (pathname.includes("/addons")) return 3;
  if (pathname.includes("/payment")) return 4;
  return 0;
};

/**
 * BookingWizard - Main wizard layout with stepper and summary sidebar
 */
const BookingWizard = () => {
  const router = useRouter<CwsRouter>();
  const state = useRouterState();
  const [booking] = useStore(bookingAtom);

  const currentStep = getStepFromPath(state.url.pathname);

  // Determine which steps are completed based on booking state
  const getStepState = (
    stepIndex: number,
  ): "completed" | "current" | "upcoming" => {
    if (stepIndex < currentStep) return "completed";
    if (stepIndex === currentStep) return "current";
    return "upcoming";
  };

  // Check if we can navigate to a step (can only go back, not forward)
  const canNavigateToStep = (stepIndex: number): boolean => {
    return stepIndex < currentStep;
  };

  const handleStepClick = (stepIndex: number) => {
    if (!canNavigateToStep(stepIndex)) return;

    const step = STEPS[stepIndex];
    if (step.key === "results" && booking?.search) {
      router.go(step.path as keyof CwsRouter, {
        query: {
          from: booking.search.from,
          to: booking.search.to,
          date: booking.search.date,
          passengers: String(booking.search.passengers),
        },
      });
    } else if (step.key === "fareclass" && booking?.selectedTrip) {
      router.go(step.path as keyof CwsRouter, {
        query: {
          tripId: booking.selectedTrip.id,
          date: booking.search?.date ?? "",
        },
      });
    } else {
      router.go(step.path as keyof CwsRouter, {});
    }
  };

  return (
    <Flex flex={1} direction="column" bg="var(--alepha-background)">
      {/* Header with route info and back button */}
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
        <Container size="xl" py="md" pos="relative">
          <Group justify="space-between" align="center">
            <Group gap="md">
              <ActionButton
                variant="subtle"
                c="white"
                leftSection={<IconArrowLeft size={18} />}
                href={router.path("bookingSearch")}
              >
                New Search
              </ActionButton>

              {booking?.search && (
                <>
                  <Divider orientation="vertical" color="dark.5" h={24} />
                  <Group gap="xs">
                    <IconTrain size={18} color="white" />
                    <Text c="white" fw={600}>
                      {booking.search.from}
                    </Text>
                    <Text c="dark.4">→</Text>
                    <Text c="white" fw={600}>
                      {booking.search.to}
                    </Text>
                  </Group>
                  <Badge
                    variant="outline"
                    color="gray"
                    styles={{
                      root: {
                        borderColor: "rgba(255,255,255,0.3)",
                        color: "white",
                      },
                    }}
                  >
                    {booking.search.date}
                  </Badge>
                  <Badge
                    variant="outline"
                    color="gray"
                    styles={{
                      root: {
                        borderColor: "rgba(255,255,255,0.3)",
                        color: "white",
                      },
                    }}
                  >
                    {booking.search.passengers} passenger
                    {booking.search.passengers > 1 ? "s" : ""}
                  </Badge>
                </>
              )}
            </Group>

            {booking?.selectedTrip && (
              <Group gap="xs">
                <Text c="dark.3" size="sm">
                  {booking.selectedTrip.trainNumber}
                </Text>
                <Text c="white" fw={500}>
                  {booking.selectedTrip.departureTime} -{" "}
                  {booking.selectedTrip.arrivalTime}
                </Text>
              </Group>
            )}
          </Group>
        </Container>
      </Box>

      {/* Stepper Navigation */}
      <Paper
        shadow="sm"
        py="md"
        style={{
          borderBottom: "1px solid var(--alepha-border)",
          position: "sticky",
          top: 60,
          zIndex: 100,
          backgroundColor: "var(--alepha-elevated)",
        }}
      >
        <Container size="xl">
          <Stepper
            active={currentStep}
            size="sm"
            iconSize={36}
            styles={{
              step: {
                cursor: "pointer",
              },
              stepIcon: {
                transition: "transform 0.2s ease",
                "&:hover": {
                  transform: "scale(1.05)",
                },
              },
              stepLabel: {
                fontWeight: 500,
              },
            }}
          >
            {STEPS.map((step, index) => {
              const StepIcon = step.icon;
              const stepState = getStepState(index);
              const isClickable = canNavigateToStep(index);

              return (
                <Stepper.Step
                  key={step.key}
                  label={step.label}
                  description={step.description}
                  icon={<StepIcon size={18} />}
                  completedIcon={<IconCheck size={18} />}
                  onClick={() => isClickable && handleStepClick(index)}
                  style={{
                    cursor: isClickable ? "pointer" : "default",
                    opacity: stepState === "upcoming" ? 0.5 : 1,
                  }}
                />
              );
            })}
          </Stepper>
        </Container>
      </Paper>

      {/* Main Content Area with optional Summary Sidebar */}
      <Container size="xl" py="xl" style={{ flex: 1 }}>
        <Flex gap="xl" align="flex-start">
          {/* Step Content */}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <NestedView />
          </Box>

          {/* Summary Sidebar - shown after train selection */}
          {booking?.selectedTrip && currentStep >= 1 && (
            <Box
              w={340}
              style={{
                flexShrink: 0,
                position: "sticky",
                top: 140,
              }}
              visibleFrom="md"
            >
              <BookingSummary />
            </Box>
          )}
        </Flex>
      </Container>
    </Flex>
  );
};

export default BookingWizard;
