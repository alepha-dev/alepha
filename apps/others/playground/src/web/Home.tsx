import { Flex, TypeForm, useDialog } from "@alepha/ui";
import { t } from "alepha";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import type { AppSecurity } from "../api/AppSecurity.ts";

const Home = () => {
  const client = useClient<AppSecurity>();
  const dialog = useDialog();

  const form = useForm({
    schema: t.object({
      ping: t.string(),
    }),
    handler: async (body) => {
      const response = await client.ping({
        body,
      });
      return dialog.alert({
        message: JSON.stringify(response),
      });
    },
  });

  return (
    <Flex fill p="md">
      <TypeForm form={form} />
    </Flex>
  );
};

export default Home;
