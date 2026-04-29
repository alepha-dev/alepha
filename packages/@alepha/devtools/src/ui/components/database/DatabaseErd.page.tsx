import { devMetadataSchema } from "@alepha/devtools";
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
    <div className="relative flex flex-1">
      <DatabaseErd entities={entities} />
    </div>
  );
};

export default DatabaseErdPage;
