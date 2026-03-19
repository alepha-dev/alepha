import { Flex, Text } from "@alepha/ui";
import { useAuth } from "alepha/react/auth";

// ─────────────────────────────────────────────────────────────────────────────

const AdminDashboard = () => {
  const auth = useAuth();

  return (
    <Flex elevated fill col pos="relative" style={{ overflow: "hidden" }}>
      <Flex
        bg="yellow"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 256,
          height: 256,
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />

      {/* Header */}
      <Flex gap={4} p={128} pb="xl" style={{ zIndex: 1 }}>
        <Flex col pos={"relative"}>
          <Text muted bold small uppercase>
            Account Home
          </Text>
          <Text
            top={10}
            pos={"absolute"}
            left={-20}
            fz={42}
            c={"yellow"}
            style={{ transform: "rotate(-15deg)" }}
          >
            !
          </Text>
          <Text fz={36}>Hello, {auth.user?.name ?? "Admin"}</Text>
          <Text muted>
            This is your admin dashboard. You can manage resources from the
            sidebar menu.
          </Text>
        </Flex>
      </Flex>
    </Flex>
  );
};

export default AdminDashboard;
