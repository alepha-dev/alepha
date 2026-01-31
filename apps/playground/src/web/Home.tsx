import { Flex, TypeForm } from "@alepha/ui";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import type { AppSecurity } from "../api/AppSecurity.ts";

const Home = () => {
  const client = useClient<AppSecurity>();
  const schema = client.ping.schema();

  const form = useForm({
    schema: schema.body,
    handler: (body) => {
      console.log(body);
    },
  });

  return (
    <Flex p="md">
      <TypeForm form={form} />
    </Flex>
  );
};

export default Home;
