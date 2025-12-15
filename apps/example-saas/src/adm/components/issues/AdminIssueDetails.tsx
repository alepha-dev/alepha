import { useAction, useClient, useRouter, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCalendar,
  IconCheck,
  IconPlayerPlay,
  IconRefresh,
  IconTicket,
  IconTrain,
  IconUser,
  IconUserCheck,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { AgentController } from "../../../api/agents/controllers/AgentController.ts";
import type { AgentProfile } from "../../../api/agents/entities/agentProfiles.ts";
import type { BookingController } from "../../../api/bookings/controllers/BookingController.ts";
import type { Booking } from "../../../api/bookings/entities/bookings.ts";
import type { CustomerController } from "../../../api/customers/controllers/CustomerController.ts";
import type { Customer } from "../../../api/customers/entities/customers.ts";
import type { IssueController } from "../../../api/issues/controllers/IssueController.ts";
import type { Issue } from "../../../api/issues/entities/issues.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  open: "blue",
  pending: "yellow",
  accepted: "green",
  rejected: "red",
  cancelled: "gray",
  archived: "gray",
};

const priorityColors: Record<string, string> = {
  low: "gray",
  medium: "blue",
  high: "orange",
  urgent: "red",
};

const creatorTypeLabels: Record<string, string> = {
  system: "System",
  customer: "Customer",
  agent: "Agent",
};

const AdminIssueDetails = () => {
  const state = useRouterState();
  const router = useRouter<AdmRouter>();
  const issueClient = useClient<IssueController>();
  const customerClient = useClient<CustomerController>();
  const bookingClient = useClient<BookingController>();
  const agentClient = useClient<AgentController>();
  const { l } = useI18n();
  const issueId = state.params.issueId as string;

  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);

  // Lazy-loaded contextual data
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [assignedAgent, setAssignedAgent] = useState<AgentProfile | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);

  // Available agents for assignment
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  // Modals
  const [assignOpened, { open: openAssign, close: closeAssign }] =
    useDisclosure(false);
  const [resolveOpened, { open: openResolve, close: closeResolve }] =
    useDisclosure(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolveAction, setResolveAction] = useState<"accept" | "reject">(
    "accept",
  );

  const loadIssue = async () => {
    try {
      const data = await issueClient.getIssue({ params: { id: issueId } });
      setIssue(data);

      // Lazy load related data
      if (data.customerId) {
        setCustomerLoading(true);
        try {
          const customerData = await customerClient.getCustomer({
            params: { id: data.customerId },
          });
          setCustomer(customerData);
        } catch {
          // Customer may have been deleted
        } finally {
          setCustomerLoading(false);
        }
      }

      if (data.bookingId) {
        setBookingLoading(true);
        try {
          const bookingData = await bookingClient.getBooking({
            params: { id: data.bookingId },
          });
          setBooking(bookingData);
        } catch {
          // Booking may have been deleted
        } finally {
          setBookingLoading(false);
        }
      }

      if (data.assignedAgentId) {
        setAgentLoading(true);
        try {
          const agentData = await agentClient.getAgent({
            params: { id: data.assignedAgentId },
          });
          setAssignedAgent(agentData);
        } catch {
          // Agent may have been deleted
        } finally {
          setAgentLoading(false);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIssue();
  }, [issueId]);

  // Load available agents when assign modal opens
  useEffect(() => {
    if (assignOpened && agents.length === 0) {
      const loadAgents = async () => {
        setAgentsLoading(true);
        try {
          const response = await agentClient.findAgents({
            query: { status: "active", size: 100 },
          });
          setAgents(response.content);
        } finally {
          setAgentsLoading(false);
        }
      };
      loadAgents();
    }
  }, [assignOpened]);

  // Actions
  const assignAction = useAction(
    {
      handler: async () => {
        if (!selectedAgentId) return;
        await issueClient.assignIssue({
          params: { id: issueId },
          body: { agentId: selectedAgentId },
        });
        closeAssign();
        setSelectedAgentId(null);
        loadIssue();
      },
    },
    [issueId, selectedAgentId],
  );

  const acceptAction = useAction(
    {
      handler: async () => {
        await issueClient.acceptIssue({
          params: { id: issueId },
          body: { resolutionNotes: resolutionNotes || undefined },
        });
        closeResolve();
        setResolutionNotes("");
        loadIssue();
      },
    },
    [issueId, resolutionNotes],
  );

  const rejectAction = useAction(
    {
      handler: async () => {
        await issueClient.rejectIssue({
          params: { id: issueId },
          body: { resolutionNotes: resolutionNotes || undefined },
        });
        closeResolve();
        setResolutionNotes("");
        loadIssue();
      },
    },
    [issueId, resolutionNotes],
  );

  const cancelAction = useAction(
    {
      handler: async () => {
        await issueClient.cancelIssue({
          params: { id: issueId },
          body: {},
        });
        loadIssue();
      },
    },
    [issueId],
  );

  const reopenAction = useAction(
    {
      handler: async () => {
        await issueClient.reopenIssue({
          params: { id: issueId },
        });
        loadIssue();
      },
    },
    [issueId],
  );

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!issue) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Issue not found</Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" gap="md">
      <Grid>
        {/* Issue Details Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Issue Details</Text>
                <Group gap="xs">
                  <Badge
                    size="lg"
                    variant="light"
                    color={statusColors[issue.status]}
                  >
                    {issue.status.charAt(0).toUpperCase() +
                      issue.status.slice(1)}
                  </Badge>
                  <Badge
                    size="lg"
                    variant="outline"
                    color={priorityColors[issue.priority]}
                  >
                    {issue.priority.charAt(0).toUpperCase() +
                      issue.priority.slice(1)}
                  </Badge>
                </Group>
              </Group>

              <Stack gap="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconUser size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Created By
                  </Text>
                  <Text size="sm">
                    {creatorTypeLabels[issue.creatorType] || issue.creatorType}
                  </Text>
                </Group>

                <Group gap="sm">
                  <ThemeIcon size="sm" variant="light" color="gray">
                    <IconCalendar size={14} />
                  </ThemeIcon>
                  <Text size="sm" c="dimmed" w={100}>
                    Created
                  </Text>
                  <Text size="sm">{l(issue.createdAt, { date: "long" })}</Text>
                </Group>

                {issue.assignedAt && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="blue">
                      <IconUserCheck size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Assigned
                    </Text>
                    <Text size="sm">
                      {l(issue.assignedAt, { date: "long" })}
                    </Text>
                  </Group>
                )}

                {issue.resolvedAt && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="green">
                      <IconCheck size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Resolved
                    </Text>
                    <Text size="sm">
                      {l(issue.resolvedAt, { date: "long" })}
                    </Text>
                  </Group>
                )}

                {issue.category && (
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconTicket size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Category
                    </Text>
                    <Text size="sm">{issue.category}</Text>
                  </Group>
                )}

                {issue.tags && issue.tags.length > 0 && (
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>
                      Tags
                    </Text>
                    <Group gap="xs">
                      {issue.tags.map((tag: string) => (
                        <Badge key={tag} size="sm" variant="light">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  </Stack>
                )}

                {issue.description && (
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>
                      Description
                    </Text>
                    <Text
                      size="sm"
                      c="dimmed"
                      style={{ whiteSpace: "pre-wrap" }}
                    >
                      {issue.description}
                    </Text>
                  </Stack>
                )}

                {issue.resolutionNotes && (
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>
                      Resolution Notes
                    </Text>
                    <Text
                      size="sm"
                      c="dimmed"
                      style={{ whiteSpace: "pre-wrap" }}
                    >
                      {issue.resolutionNotes}
                    </Text>
                  </Stack>
                )}
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Actions Card */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Actions</Text>

              <Stack gap="sm">
                {issue.status === "open" && (
                  <ActionButton
                    variant="light"
                    color="blue"
                    leftSection={<IconUserCheck size={16} />}
                    onClick={openAssign}
                    fullWidth
                  >
                    Assign to Agent
                  </ActionButton>
                )}

                {issue.status === "pending" && (
                  <>
                    <ActionButton
                      variant="light"
                      color="green"
                      leftSection={<IconCheck size={16} />}
                      onClick={() => {
                        setResolveAction("accept");
                        openResolve();
                      }}
                      fullWidth
                    >
                      Accept (Resolve)
                    </ActionButton>
                    <ActionButton
                      variant="light"
                      color="red"
                      leftSection={<IconX size={16} />}
                      onClick={() => {
                        setResolveAction("reject");
                        openResolve();
                      }}
                      fullWidth
                    >
                      Reject
                    </ActionButton>
                  </>
                )}

                {(issue.status === "cancelled" ||
                  issue.status === "rejected") && (
                  <ActionButton
                    variant="light"
                    color="blue"
                    leftSection={<IconRefresh size={16} />}
                    onClick={reopenAction.run}
                    loading={reopenAction.loading}
                    fullWidth
                  >
                    Reopen Issue
                  </ActionButton>
                )}

                {issue.status !== "cancelled" &&
                  issue.status !== "archived" && (
                    <ActionButton
                      variant="light"
                      color="gray"
                      leftSection={<IconX size={16} />}
                      onClick={cancelAction.run}
                      loading={cancelAction.loading}
                      fullWidth
                    >
                      Cancel Issue
                    </ActionButton>
                  )}
              </Stack>

              {/* Assigned Agent */}
              {issue.assignedAgentId && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Assigned Agent
                  </Text>
                  {agentLoading ? (
                    <Loader size="sm" />
                  ) : assignedAgent ? (
                    <Card withBorder p="xs">
                      <Group>
                        <ThemeIcon size="sm" variant="light" color="blue">
                          <IconUser size={14} />
                        </ThemeIcon>
                        <Stack gap={0}>
                          <Text size="sm" fw={500}>
                            {assignedAgent.employeeId || "Agent"}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {assignedAgent.jobTitle ||
                              assignedAgent.department ||
                              "—"}
                          </Text>
                        </Stack>
                      </Group>
                    </Card>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Agent not found
                    </Text>
                  )}
                </Stack>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Customer Context Card (lazy loaded) */}
        {issue.customerId && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder h="100%">
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={600}>Related Customer</Text>
                  {customer && (
                    <ActionButton
                      variant="subtle"
                      size="xs"
                      onClick={() =>
                        router.go("adminCustomerDetails", {
                          params: { customerId: issue.customerId as string },
                        })
                      }
                    >
                      View
                    </ActionButton>
                  )}
                </Group>

                {customerLoading ? (
                  <Flex justify="center" py="md">
                    <Loader size="sm" />
                  </Flex>
                ) : customer ? (
                  <Stack gap="sm">
                    <Group gap="sm">
                      <ThemeIcon size="sm" variant="light" color="blue">
                        <IconUser size={14} />
                      </ThemeIcon>
                      <Text size="sm" fw={500}>
                        {customer.firstName} {customer.lastName}
                      </Text>
                      <Badge size="sm" variant="light">
                        {customer.loyaltyTier}
                      </Badge>
                    </Group>
                    {customer.phone && (
                      <Text size="sm" c="dimmed">
                        {customer.phone}
                      </Text>
                    )}
                    <Group gap="md">
                      <Text size="xs" c="dimmed">
                        {customer.totalBookings} bookings
                      </Text>
                      <Text size="xs" c="dimmed">
                        €{customer.totalSpent.toFixed(2)} spent
                      </Text>
                    </Group>
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    Customer not found
                  </Text>
                )}
              </Stack>
            </Card>
          </Grid.Col>
        )}

        {/* Booking Context Card (lazy loaded) */}
        {issue.bookingId && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder h="100%">
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={600}>Related Booking</Text>
                  {booking && (
                    <ActionButton
                      variant="subtle"
                      size="xs"
                      onClick={() =>
                        router.go("adminBookingDetails", {
                          params: { bookingId: issue.bookingId as string },
                        })
                      }
                    >
                      View
                    </ActionButton>
                  )}
                </Group>

                {bookingLoading ? (
                  <Flex justify="center" py="md">
                    <Loader size="sm" />
                  </Flex>
                ) : booking ? (
                  <Stack gap="sm">
                    <Group gap="sm">
                      <ThemeIcon size="sm" variant="light" color="green">
                        <IconTrain size={14} />
                      </ThemeIcon>
                      <Text size="sm" fw={500} ff="monospace">
                        {booking.reference}
                      </Text>
                      <Badge
                        size="sm"
                        variant="light"
                        color={
                          booking.status === "confirmed" ? "green" : "gray"
                        }
                      >
                        {booking.status}
                      </Badge>
                    </Group>
                    <Text size="sm">
                      {booking.departureStation} → {booking.arrivalStation}
                    </Text>
                    <Group gap="md">
                      <Text size="xs" c="dimmed">
                        {booking.travelDate}
                      </Text>
                      <Text size="xs" c="dimmed">
                        €{booking.totalPrice.toFixed(2)}
                      </Text>
                    </Group>
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    Booking not found
                  </Text>
                )}
              </Stack>
            </Card>
          </Grid.Col>
        )}
      </Grid>

      {/* Assign Modal */}
      <Modal opened={assignOpened} onClose={closeAssign} title="Assign Issue">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Select an agent to assign this issue to. The issue will transition
            to &quot;Pending&quot; status.
          </Text>
          <Select
            label="Agent"
            placeholder={
              agentsLoading ? "Loading agents..." : "Select an agent"
            }
            data={agents.map((agent) => ({
              value: agent.id,
              label: `${agent.employeeId || agent.id.slice(0, 8)} - ${agent.jobTitle || agent.department || "Agent"}`,
            }))}
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            disabled={agentsLoading}
            searchable
          />
          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closeAssign}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color="blue"
              leftSection={<IconPlayerPlay size={16} />}
              onClick={assignAction.run}
              loading={assignAction.loading}
              disabled={!selectedAgentId}
            >
              Assign
            </ActionButton>
          </Group>
        </Stack>
      </Modal>

      {/* Resolve Modal */}
      <Modal
        opened={resolveOpened}
        onClose={closeResolve}
        title={resolveAction === "accept" ? "Accept Issue" : "Reject Issue"}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {resolveAction === "accept"
              ? "Mark this issue as resolved. You can add notes about the resolution."
              : "Reject this issue. Please provide a reason for rejection."}
          </Text>
          <Textarea
            label="Resolution Notes"
            placeholder={
              resolveAction === "accept"
                ? "What was done to resolve this issue..."
                : "Reason for rejection..."
            }
            rows={4}
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.currentTarget.value)}
          />
          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closeResolve}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color={resolveAction === "accept" ? "green" : "red"}
              leftSection={
                resolveAction === "accept" ? (
                  <IconCheck size={16} />
                ) : (
                  <IconX size={16} />
                )
              }
              onClick={
                resolveAction === "accept" ? acceptAction.run : rejectAction.run
              }
              loading={acceptAction.loading || rejectAction.loading}
            >
              {resolveAction === "accept" ? "Accept" : "Reject"}
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminIssueDetails;
