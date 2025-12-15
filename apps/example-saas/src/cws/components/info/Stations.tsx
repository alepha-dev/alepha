import { useRouter } from "@alepha/react";
import { ActionButton } from "@alepha/ui";
import {
  Badge,
  Box,
  Card,
  Container,
  Flex,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBuilding,
  IconMapPin,
  IconTrain,
  IconWifi,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import type { StationResource } from "../../../api/topology/schemas/stationSchema.ts";
import type { CwsRouter } from "../../CwsRouter.ts";
import { Footer } from "../booking/search/Footer.tsx";

export interface StationsProps {
  stations: StationResource[];
}

const StationCard = ({ station }: { station: StationResource }) => {
  const router = useRouter<CwsRouter>();

  return (
    <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
      <Card withBorder radius="lg" p={0} h="100%">
        <Box
          h={160}
          bg="linear-gradient(135deg, var(--mantine-color-blue-6) 0%, var(--mantine-color-cyan-6) 100%)"
          style={{ position: "relative" }}
        >
          <Flex
            h="100%"
            align="center"
            justify="center"
            direction="column"
            gap="xs"
          >
            <IconTrain size={48} color="white" opacity={0.8} />
            <Badge variant="white" color="dark" size="lg">
              {station.code}
            </Badge>
          </Flex>
          {station.platforms && (
            <Badge
              pos="absolute"
              top={12}
              right={12}
              variant="filled"
              color="dark"
            >
              {station.platforms} platforms
            </Badge>
          )}
        </Box>

        <Stack gap="md" p="lg">
          <Stack gap={4}>
            <Title order={4}>{station.name}</Title>
            <Group gap="xs">
              <IconMapPin size={14} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed">
                {station.city}, {station.country}
              </Text>
            </Group>
          </Stack>

          {station.description && (
            <Text size="sm" c="dimmed" lineClamp={3}>
              {station.description}
            </Text>
          )}

          <SimpleGrid cols={2} spacing="xs">
            <Group gap={4}>
              <ThemeIcon size="sm" variant="light" color="green">
                <IconWifi size={12} />
              </ThemeIcon>
              <Text size="xs">Free WiFi</Text>
            </Group>
            <Group gap={4}>
              <ThemeIcon size="sm" variant="light" color="blue">
                <IconBuilding size={12} />
              </ThemeIcon>
              <Text size="xs">Lounge</Text>
            </Group>
          </SimpleGrid>

          <ActionButton
            variant="light"
            fullWidth
            rightSection={<IconArrowRight size={16} />}
            onClick={() =>
              router.go("bookingSearch", {
                query: { from: station.code },
              })
            }
          >
            Book from {station.city}
          </ActionButton>
        </Stack>
      </Card>
    </motion.div>
  );
};

const Stations = ({ stations }: StationsProps) => {
  const router = useRouter<CwsRouter>();

  // Group stations by region
  const regions = {
    ontario: stations.filter((s: StationResource) =>
      ["CATOR", "CAOTT", "CAKNG", "CALON", "CAWIN"].includes(s.code),
    ),
    quebec: stations.filter((s: StationResource) =>
      ["CAMTL", "CAQBC"].includes(s.code),
    ),
    atlantic: stations.filter((s: StationResource) =>
      ["CAHAL", "CAMON"].includes(s.code),
    ),
    western: stations.filter((s: StationResource) =>
      ["CAVAN", "CAWPG", "CAEDM", "CAJAS"].includes(s.code),
    ),
  };

  return (
    <Box>
      {/* Hero */}
      <Box
        bg="linear-gradient(135deg, var(--mantine-color-blue-9) 0%, var(--mantine-color-dark-8) 100%)"
        py={80}
      >
        <Container size="lg">
          <Stack gap="lg" align="center" ta="center">
            <Badge variant="light" color="cyan" size="lg">
              AlephaRail Network
            </Badge>
            <Title order={1} c="white">
              Our Stations
            </Title>
            <Text size="lg" c="gray.4" maw={600}>
              Discover 13 stations across Canada, from the historic architecture
              of Toronto Union Station to the mountain gateway of Jasper.
            </Text>
          </Stack>
        </Container>
      </Box>

      {/* Stats */}
      <Container size="lg" mt={-40}>
        <Card withBorder radius="lg" p="xl">
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Stack align="center" gap={4}>
              <Text size="2rem" fw={700} c="blue">
                13
              </Text>
              <Text size="sm" c="dimmed">
                Stations
              </Text>
            </Stack>
            <Stack align="center" gap={4}>
              <Text size="2rem" fw={700} c="blue">
                5
              </Text>
              <Text size="sm" c="dimmed">
                Provinces
              </Text>
            </Stack>
            <Stack align="center" gap={4}>
              <Text size="2rem" fw={700} c="blue">
                6,000+
              </Text>
              <Text size="sm" c="dimmed">
                km of Track
              </Text>
            </Stack>
            <Stack align="center" gap={4}>
              <Text size="2rem" fw={700} c="blue">
                72M
              </Text>
              <Text size="sm" c="dimmed">
                Annual Passengers
              </Text>
            </Stack>
          </SimpleGrid>
        </Card>
      </Container>

      {/* Regions */}
      <Container size="lg" py={60}>
        <Stack gap={60}>
          {/* Ontario */}
          <Stack gap="lg">
            <Group gap="xs">
              <ThemeIcon size="lg" variant="light" color="blue">
                <IconMapPin size={20} />
              </ThemeIcon>
              <Title order={2}>Ontario</Title>
              <Badge variant="light">{regions.ontario.length} stations</Badge>
            </Group>
            <Grid>
              {regions.ontario.map((station) => (
                <Grid.Col key={station.id} span={{ base: 12, sm: 6, md: 4 }}>
                  <StationCard station={station} />
                </Grid.Col>
              ))}
            </Grid>
          </Stack>

          {/* Quebec */}
          <Stack gap="lg">
            <Group gap="xs">
              <ThemeIcon size="lg" variant="light" color="violet">
                <IconMapPin size={20} />
              </ThemeIcon>
              <Title order={2}>Qu&eacute;bec</Title>
              <Badge variant="light" color="violet">
                {regions.quebec.length} stations
              </Badge>
            </Group>
            <Grid>
              {regions.quebec.map((station) => (
                <Grid.Col key={station.id} span={{ base: 12, sm: 6, md: 4 }}>
                  <StationCard station={station} />
                </Grid.Col>
              ))}
            </Grid>
          </Stack>

          {/* Atlantic */}
          <Stack gap="lg">
            <Group gap="xs">
              <ThemeIcon size="lg" variant="light" color="cyan">
                <IconMapPin size={20} />
              </ThemeIcon>
              <Title order={2}>Atlantic Canada</Title>
              <Badge variant="light" color="cyan">
                {regions.atlantic.length} stations
              </Badge>
            </Group>
            <Grid>
              {regions.atlantic.map((station) => (
                <Grid.Col key={station.id} span={{ base: 12, sm: 6, md: 4 }}>
                  <StationCard station={station} />
                </Grid.Col>
              ))}
            </Grid>
          </Stack>

          {/* Western */}
          <Stack gap="lg">
            <Group gap="xs">
              <ThemeIcon size="lg" variant="light" color="orange">
                <IconMapPin size={20} />
              </ThemeIcon>
              <Title order={2}>Western Canada</Title>
              <Badge variant="light" color="orange">
                {regions.western.length} stations
              </Badge>
            </Group>
            <Grid>
              {regions.western.map((station) => (
                <Grid.Col key={station.id} span={{ base: 12, sm: 6, md: 4 }}>
                  <StationCard station={station} />
                </Grid.Col>
              ))}
            </Grid>
          </Stack>
        </Stack>
      </Container>

      {/* CTA */}
      <Box bg="var(--mantine-color-blue-light)" py={60}>
        <Container size="md">
          <Stack align="center" gap="lg" ta="center">
            <Title order={2}>Ready to Travel?</Title>
            <Text c="dimmed" maw={500}>
              Book your journey across Canada's most scenic rail routes. From
              coast to coast, AlephaRail connects communities sustainably.
            </Text>
            <ActionButton
              size="lg"
              rightSection={<IconArrowRight size={18} />}
              onClick={() => router.go("bookingSearch")}
            >
              Book Your Trip
            </ActionButton>
          </Stack>
        </Container>
      </Box>

      <Footer />
    </Box>
  );
};

export default Stations;
