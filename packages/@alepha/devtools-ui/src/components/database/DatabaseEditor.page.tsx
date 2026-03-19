import { devMetadataSchema } from "alepha/devtools";
import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useEffect, useState } from "react";
import { DatabaseEditor } from "./DatabaseEditor.tsx";

const DatabaseEditorPage = () => {
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

  return <DatabaseEditor entities={entities} />;
};

export default DatabaseEditorPage;
