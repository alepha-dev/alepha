import { useAction, useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { UploadsApi } from "../api/UploadsApi.ts";

export interface HomeProps {
  count: number;
  files: Array<{ id: string; name: string }>;
}

/**
 * Deliberately plain. This page exists to prove that state survives a redeploy,
 * not to look like anything.
 */
const Home = (props: HomeProps) => {
  const uploadsApi = useClient<UploadsApi>();
  const router = useRouter();
  const [file, setFile] = useState<File | undefined>();

  const upload = useAction(
    {
      handler: async () => {
        if (!file) {
          return;
        }
        await uploadsApi.upload({ body: { file } });
        await router.reload();
      },
    },
    [file],
  );

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 640 }}>
      <h1>example-bay-app</h1>
      <p>
        Visits: <strong>{props.count}</strong> — from the SQLite database Bay
        provisioned.
      </p>

      <h2>Uploads</h2>
      <p>
        Stored in the directory Bay made writable because the app declares{" "}
        <code>$storage</code>. These must survive a redeploy.
      </p>
      <input
        type="file"
        onChange={(event) => setFile(event.target.files?.[0])}
      />
      <button
        type="button"
        onClick={upload.run}
        disabled={!file || upload.loading}
      >
        {upload.loading ? "Uploading…" : "Upload"}
      </button>
      {upload.error && (
        <p style={{ color: "crimson" }}>{upload.error.message}</p>
      )}

      <ul>
        {props.files.map((f) => (
          <li key={f.id}>{f.name}</li>
        ))}
      </ul>
      {props.files.length === 0 && <p>No files yet.</p>}
    </main>
  );
};

export default Home;
