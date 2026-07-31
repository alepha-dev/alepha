import { Alert, AlertDescription } from "@alepha/ui/components/ui/alert";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useAction, useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { AlertCircle, CheckCircle2, Upload } from "lucide-react";
import { useState } from "react";
import type { BayAppController } from "../../api/controllers/BayAppController.ts";

/**
 * Upload an artifact and deploy it.
 *
 * The artifact is whatever `alepha pack` produced — `dist/` (with its derived
 * `dist/manifest.json`) plus `migrations/`. Nothing here asks the operator to
 * describe the app: the resources it needs, its crons and its runtime are all
 * read out of the manifest, which the build filled in by introspecting the
 * primitives. The only thing pulse has to ask is which environment this
 * deploy is, because that is not a property of the artifact.
 */
const DeployCard = () => {
  const bayApi = useClient<BayAppController>();
  const router = useRouter();

  const [file, setFile] = useState<File | undefined>();
  const [name, setName] = useState("");
  const [env, setEnv] = useState("production");
  const [deployed, setDeployed] = useState<string | undefined>();

  const deploy = useAction(
    {
      handler: async () => {
        if (!file) {
          return;
        }
        setDeployed(undefined);
        const result = await bayApi.deploy({
          body: { file, name, env },
        });
        setDeployed(result.url);
        // Re-run the page loader so the new release shows up in the list
        // without a manual refresh.
        await router.reload();
      },
    },
    [file, name, env],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy</CardTitle>
        <CardDescription>
          Upload the <code>.tar.gz</code> from <code>alepha pack</code>. Build
          with <code>--target=bare</code> — a Cloudflare artifact cannot run
          here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="artifact">Artifact</Label>
          <Input
            id="artifact"
            type="file"
            accept=".gz,.tgz,application/gzip"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              value={name}
              placeholder="from the artifact"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="env">Environment</Label>
            <Input
              id="env"
              value={env}
              onChange={(event) => setEnv(event.target.value)}
            />
          </div>
        </div>

        {deploy.error && (
          <Alert variant="destructive">
            <AlertCircle />
            {/*
              Bay's messages are written for an operator — "rebuild with
              `alepha build --target=bare`" — so show them verbatim rather than
              replacing them with a generic failure.
            */}
            <AlertDescription>{deploy.error.message}</AlertDescription>
          </Alert>
        )}

        {deployed && (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>
              Deployed —{" "}
              <a
                href={deployed}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {deployed}
              </a>
            </AlertDescription>
          </Alert>
        )}

        <div>
          <Button
            onClick={deploy.run}
            disabled={!file || !env || deploy.loading}
          >
            <Upload />
            {deploy.loading ? "Deploying…" : "Deploy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeployCard;
