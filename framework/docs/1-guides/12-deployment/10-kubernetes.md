# Kubernetes

An image built by [alepha image](/docs/cli-commands-image) runs on Kubernetes with nothing Alepha-specific in the cluster. This page is one Deployment and one Service, and why each field is set the way it is. Every manifest here was applied to a kind cluster (Kubernetes 1.34), with the standard image and with the compiled one.

```yaml filename=myapp.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: myapp-config
data:
  DATA_DIR: /data
---
apiVersion: v1
kind: Secret
metadata:
  name: myapp-secrets
type: Opaque
stringData:
  APP_SECRET: replace-me # openssl rand -hex 32
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app: myapp
    spec:
      terminationGracePeriodSeconds: 25
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: ghcr.io/myorg/myapp:1.4.0
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - configMapRef:
                name: myapp-config
            - secretRef:
                name: myapp-secrets
          startupProbe:
            httpGet:
              path: /livez
              port: http
            periodSeconds: 1
            failureThreshold: 30
          livenessProbe:
            httpGet:
              path: /livez
              port: http
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            periodSeconds: 2
            failureThreshold: 1
          lifecycle:
            preStop:
              sleep:
                seconds: 10
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
  ports:
    - name: http
      port: 80
      targetPort: http
```

## Probes

Every Alepha server answers three paths (see [Liveness and readiness](/docs/guides-server-middlewares#liveness-and-readiness)):

| Probe            | Path      | Why                                                                                       |
| ---------------- | --------- | ----------------------------------------------------------------------------------------- |
| `startupProbe`   | `/livez`  | Nothing answers before the listener is bound. Once it is, `/livez` answers 200.           |
| `livenessProbe`  | `/livez`  | 200 whatever the lifecycle: a restart only helps a process that stopped answering at all. |
| `readinessProbe` | `/readyz` | 503 while the app starts (migrations included) and from the moment it starts to stop.     |

⚠️ **Never point a liveness probe at `/health`.** It answers 503 until the app is ready, so a slow migration gets the pod restarted, which runs the migration again, in a loop.

The startup probe gives the process 30 seconds to bind its port; readiness, not the startup probe, covers a long migration, since `/livez` answers while it runs and `/readyz` does not.

## Shutdown

On SIGTERM the app stops within 8 seconds: its stop hooks are bounded, and the listener closes as soon as its own stop hook runs. The framework adds no drain delay of its own. `/readyz` turns 503 when the stop begins, but by then Kubernetes has already removed the pod from the Service's endpoints, and what is left is the time that removal takes to reach every node.

So the manifest drains before the stop, with a `preStop` wait: the pod stops receiving new connections while it still serves the ones it has. `terminationGracePeriodSeconds` is that wait, plus the 8 seconds, plus a margin: `10 + 8 + 7 = 25` above.

Use the `sleep` lifecycle action, not an `exec` of `sleep`: the compiled image has no shell and no `sleep` binary, so an `exec` hook fails and is skipped. The `sleep` action needs Kubernetes 1.30 or later (beta and on by default from 1.30, generally available in 1.34).

Measured on the kind cluster, with a client inside the cluster requesting `/health` through the Service as fast as it could while `kubectl rollout restart` replaced both pods:

| Image    | `preStop` wait | Requests | Failed |
| -------- | -------------- | -------- | ------ |
| standard | 10 seconds     | 30,129   | 0      |
| standard | none           | 14,216   | 7      |
| compiled | 10 seconds     | 13,027   | 0      |

## Security context

Both images run as a non-root numeric user (`1000` standard, `65532:65532` compiled), which is what `runAsNonRoot: true` checks. Capabilities are dropped and the root file system is read-only.

**One path needs to be writable: the data directory.** Unset, the local providers write under `/app/node_modules/.alepha`, inside the image, which a read-only root refuses. Point `DATA_DIR` (and a SQLite `DATABASE_URL`, when there is one) at a mounted volume: an `emptyDir` above, or a PersistentVolumeClaim for data that must outlive the pod. Nothing else is written: not `/tmp`, not `/app`.

## Configuration

Configuration is environment variables, from a ConfigMap and a Secret through `envFrom`. `APP_SECRET` goes in the Secret: it signs sessions and tokens, and a production app refuses to start without it. Everything the image bakes with `image.env` is a default that these override.

## More than one replica

What moves to Redis, and how cron jobs are claimed so that one replica runs each, is the same as anywhere else: see [More than one instance](/docs/guides-deployment-bare#more-than-one-instance-set-redis_url). What Kubernetes adds is the database: a SQLite file on a volume means one replica, so several replicas need a shared database (`DATABASE_URL=postgres://...`).

## Supply chain

`alepha image --sbom --provenance --push` attaches an SBOM and a SLSA provenance to the image index (see [Evidence: SBOM and provenance](/docs/cli-commands-image#evidence-sbom-and-provenance)). Read them back before admitting an image:

```bash
docker buildx imagetools inspect ghcr.io/myorg/myapp:1.4.0 --format '{{json .SBOM}}'
docker buildx imagetools inspect ghcr.io/myorg/myapp:1.4.0 --format '{{json .Provenance}}'
```

Signing is a step of your CI after the push, with cosign or your registry's own signing; `alepha image` does not sign. An admission policy can then require the signature and the attestations.
