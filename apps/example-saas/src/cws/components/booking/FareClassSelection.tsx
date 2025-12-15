import { useClient, useInject, useRouter, useStore } from "@alepha/react";
import { ActionButton, Text } from "@alepha/ui";
import { Badge, Box, Card, Divider, Group, Stack, Title } from "@mantine/core";
import {
  IconArrowRight,
  IconCheck,
  IconClock,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import type { PricingController } from "../../../api/pricing/controllers/PricingController.ts";
import {
  bookingAtom,
  type FareClassSelection as FareClassType,
} from "../../atoms/bookingAtom.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { BookingService } from "../../services/BookingService.ts";

export interface FareClassSelectionProps {
  fareClasses: FareClassType[];
  tripInstanceId: string;
}

const FareClassSelection = (props: FareClassSelectionProps) => {
  const { fareClasses, tripInstanceId } = props;
  const router = useRouter<CwsRouter>();
  const bookingService = useInject(BookingService);
  const pricingClient = useClient<PricingController>();
  const [booking] = useStore(bookingAtom);

  const handleSelectFareClass = async (fareClass: FareClassType) => {
    // Store the fare class and trip instance
    bookingService.setTripInstance(tripInstanceId);
    bookingService.setFareClass(fareClass);

    bookingService.updateBooking({
      step: "seats",
    });

    await router.go("bookingSeats");
  };

  if (!booking?.selectedTrip) {
    return (
      <Card
        withBorder
        p="xl"
        ta="center"
        bg="var(--alepha-elevated)"
        bd="1px solid var(--alepha-border)"
      >
        <Stack gap="md" align="center">
          <Text c="dimmed">No trip selected</Text>
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
        <Title order={3}>Choose Your Fare</Title>
        <Text c="dimmed" size="sm">
          {booking.search?.passengers} passenger
          {(booking.search?.passengers ?? 1) > 1 ? "s" : ""}
        </Text>
      </Group>

      <Group grow align="stretch">
        {fareClasses.map((fareClass, index) => {
          const isRecommended = fareClass.code === "STANDARD";

          return (
            <Card
              key={fareClass.id}
              withBorder
              radius="md"
              p={0}
              bg="var(--alepha-elevated)"
              bd={
                isRecommended
                  ? "2px solid var(--mantine-color-pink-6)"
                  : "1px solid var(--alepha-border)"
              }
              style={{
                overflow: "inherit",
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {isRecommended && (
                <Badge
                  color="pink"
                  variant="filled"
                  size="sm"
                  style={{
                    position: "absolute",
                    top: -10,
                    left: "50%",
                    transform: "translateX(-50%)",
                  }}
                >
                  Most Popular
                </Badge>
              )}

              <Stack gap={0} p="lg" flex={1}>
                <Text fw={700} size="lg" mb="xs">
                  {fareClass.name}
                </Text>
                <Text c="dimmed" size="sm" mb="md">
                  {fareClass.description}
                </Text>

                <Stack gap="sm" mb="lg">
                  <Group gap="xs">
                    {fareClass.isRefundable ? (
                      <IconCheck
                        size={16}
                        color="var(--mantine-color-green-6)"
                      />
                    ) : (
                      <IconX size={16} color="var(--mantine-color-red-6)" />
                    )}
                    <Text size="sm">
                      {fareClass.isRefundable
                        ? fareClass.refundFeePercent > 0
                          ? `Refundable (${fareClass.refundFeePercent}% fee)`
                          : "Fully refundable"
                        : "Non-refundable"}
                    </Text>
                  </Group>

                  <Group gap="xs">
                    {fareClass.isChangeable ? (
                      <IconRefresh
                        size={16}
                        color="var(--mantine-color-green-6)"
                      />
                    ) : (
                      <IconX size={16} color="var(--mantine-color-red-6)" />
                    )}
                    <Text size="sm">
                      {fareClass.isChangeable
                        ? fareClass.changeFeePercent > 0
                          ? `Changeable (${fareClass.changeFeePercent}% fee)`
                          : "Free changes"
                        : "No changes allowed"}
                    </Text>
                  </Group>
                </Stack>

                {fareClass.dynamicMultiplier !== 1.0 && (
                  <Badge
                    variant="light"
                    color={fareClass.dynamicMultiplier > 1 ? "red" : "green"}
                    size="sm"
                    mb="md"
                  >
                    {fareClass.dynamicMultiplier > 1
                      ? `${Math.round((fareClass.dynamicMultiplier - 1) * 100)}% surge pricing`
                      : `${Math.round((1 - fareClass.dynamicMultiplier) * 100)}% off`}
                  </Badge>
                )}

                <Box mt="auto">
                  <Divider color="var(--alepha-border)" mb="md" />

                  <Group justify="space-between" align="flex-end" mb="md">
                    <Stack gap={0}>
                      <Text size="xl" fw={700}>
                        ${fareClass.price} CAD
                      </Text>
                      <Text size="xs" c="dimmed">
                        per passenger
                      </Text>
                    </Stack>
                  </Group>

                  <ActionButton
                    variant={isRecommended ? "filled" : "light"}
                    color="pink"
                    fullWidth
                    rightSection={<IconArrowRight size={16} />}
                    onClick={() => handleSelectFareClass(fareClass)}
                  >
                    Select {fareClass.name}
                  </ActionButton>
                </Box>
              </Stack>
            </Card>
          );
        })}
      </Group>

      <Card
        withBorder
        radius="md"
        p="md"
        bg="var(--alepha-elevated)"
        bd="1px solid var(--alepha-border)"
      >
        <Group gap="xs">
          <IconClock size={18} color="var(--mantine-color-blue-6)" />
          <Text size="sm">
            Prices are valid for 15 minutes and may change based on demand.
          </Text>
        </Group>
      </Card>
    </Stack>
  );
};

export default FareClassSelection;
