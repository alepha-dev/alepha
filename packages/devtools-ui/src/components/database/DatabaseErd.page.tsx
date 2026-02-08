import { Flex } from "@mantine/core";
import { devMetadataSchema } from "alepha/devtools";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useEffect, useState } from "react";
import { DatabaseErd } from "./DatabaseErd.tsx";

const DatabaseErdPage = () => {
  const http = useInject(HttpClient);
  const [entities, setEntities] = useState<any[]>([]);

  useEffect(() => {
    http
      .fetch("/__devtools/api/metadata", {
        schema: { response: devMetadataSchema },
      })
      .then((res) => setEntities(res.data.entities ?? []))
      .catch(() => {});
  }, [http]);

  return (
    <Flex flex={1} style={{ position: "relative" }}>
      <DatabaseErd entities={entities} />
    </Flex>
  );
};

export default DatabaseErdPage;
