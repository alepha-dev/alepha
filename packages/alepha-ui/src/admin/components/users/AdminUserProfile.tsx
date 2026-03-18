import { DetailList, Flex } from "@alepha/ui";
import { Badge } from "@mantine/core";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { adminUserAtom } from "../../atoms/adminUserAtom.ts";

const AdminUserProfile = () => {
  const [user] = useStore(adminUserAtom);
  const { l } = useI18n();

  if (!user) return null;

  return (
    <DetailList
      items={[
        { label: "ID", value: user.id, copyable: user.id },
        { label: "Username", value: user.username },
        { label: "Email", value: user.email },
        {
          label: "Email Verified",
          value: user.emailVerified ? "Yes" : "No",
        },
        { label: "Phone", value: user.phoneNumber },
        { label: "First Name", value: user.firstName },
        { label: "Last Name", value: user.lastName },
        { label: "Realm", value: user.realm },
        {
          label: "Roles",
          value:
            user.roles.length > 0 ? (
              <Flex gap={4}>
                {user.roles.map((role) => (
                  <Badge key={role} size="xs" variant="default">
                    {role}
                  </Badge>
                ))}
              </Flex>
            ) : null,
        },
        {
          label: "Created",
          value: String(l(user.createdAt, { date: "lll" })),
        },
        {
          label: "Updated",
          value: String(l(user.updatedAt, { date: "lll" })),
        },
      ]}
    />
  );
};

export default AdminUserProfile;
