package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/manifest"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/state"
)

/*
specFor builds what the container runner starts for an instance, whichever
kind it is: an archive run in its runtime image, or an image app run as is.
*/
func (s *server) specFor(app state.App) (runner.Spec, runtimeChoice, error) {
	instance := s.instanceDir(app)
	env, err := runner.LoadEnvFile(filepath.Join(instance, ".env"))
	if err != nil {
		return runner.Spec{}, runtimeChoice{}, err
	}
	if app.Image != "" {
		return imageSpec(app, env), runtimeChoice{Ref: app.Image}, nil
	}
	m, err := manifest.LoadFromRelease(filepath.Join(instance, "current"))
	if err != nil {
		return runner.Spec{}, runtimeChoice{}, err
	}
	writable, err := s.writablePaths(app, m, instance)
	if err != nil {
		return runner.Spec{}, runtimeChoice{}, err
	}
	return s.containerSpec(app, m, env, instance, writable)
}

/*
imageSpec runs an image app as its image defines it: its own command, its own
working directory, its own port, with only the instance's .env added. It sees
no host path at all; state it keeps belongs in a service or a bucket, which is
what stacks are for.
*/
func imageSpec(app state.App, env map[string]string) runner.Spec {
	return runner.Spec{
		Key: app.Key(),
		Env: env,
		Sandbox: runner.Container{
			Image:       app.Image,
			Port:        app.ContainerPort,
			HostPort:    app.UpstreamPort(),
			MemoryBytes: 512 << 20,
			PidsLimit:   256,
			NanoCPUs:    nanoCPUsFor(runtime.NumCPU()),
			StopGrace:   stopGrace,
		},
	}
}

/*
waitReady decides when an instance listening on `port` is ready, and says by
which check.

An archive app is an Alepha app: Bay's probe asks its /health and falls back to
a connect. An image app may be anything, so the order is: the health path its
deploy declared (2xx), else the image's own HEALTHCHECK, else a TCP connect.
The check used is recorded, so `bay status` never claims more than was
verified: "tcp" means only that something accepted a connection.
*/
func (s *server) waitReady(app state.App, port int, candidate bool, timeout time.Duration) error {
	if app.Image == "" {
		return s.probe.WaitReady(port, timeout)
	}
	check, err := s.waitImageReady(app, port, candidate, timeout)
	if err != nil {
		return err
	}
	if err := s.store.SetHealthCheck(app.Key(), check); err != nil {
		s.log.Warn("could not record the health check", "app", app.Key(), "err", err)
	}
	return nil
}

func (s *server) waitImageReady(app state.App, port int, candidate bool, timeout time.Duration) (string, error) {
	if app.HealthPath != "" {
		return "path " + app.HealthPath, waitHTTP(port, app.HealthPath, timeout)
	}
	if d, ok := s.runner.(interface {
		WaitHealthy(key string, candidate bool, timeout time.Duration) (bool, error)
	}); ok {
		declared, err := d.WaitHealthy(app.Key(), candidate, timeout)
		if declared {
			return "image healthcheck", err
		}
		if err != nil {
			return "", err
		}
	}
	return "tcp", waitTCP(port, timeout)
}

// waitHTTP polls a path on loopback until it answers 2xx.
func waitHTTP(port int, path string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	client := &http.Client{Timeout: 2 * time.Second}
	url := "http://127.0.0.1:" + strconv.Itoa(port) + path
	var last string
	for {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		res, err := client.Do(req)
		if err == nil {
			res.Body.Close()
			if res.StatusCode >= 200 && res.StatusCode < 300 {
				return nil
			}
			last = res.Status
		} else {
			last = err.Error()
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("%s did not answer 2xx within %s (last: %s)", path, timeout, last)
		case <-time.After(250 * time.Millisecond):
		}
	}
}

// waitTCP polls a loopback port until something accepts a connection.
func waitTCP(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	for {
		conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("nothing accepted a connection on %s within %s: %w", addr, timeout, err)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// imageDeployOptions is one deploy of an image app, whatever asked for it.
type imageDeployOptions struct {
	Name, Env     string
	Domains       []string
	Image         string
	ContainerPort int
	HealthPath    string
	SecretsFile   string
}

/*
deployImage deploys an image app: register it, then start it, blue/green when
it is already serving.

A failure puts the previous record back, so the instance names what is actually
running: on a redeploy the previous container never stopped, and on a first
deploy there is nothing to name.
*/
func (s *server) deployImage(ctx context.Context, opts imageDeployOptions) (*state.App, *deployFailure) {
	if _, ok := s.runner.(containerRunner); !ok {
		return nil, &deployFailure{Status: http.StatusBadRequest, Err: fmt.Errorf("image apps need Bay's Docker runner")}
	}
	var secrets map[string]string
	if opts.SecretsFile != "" {
		parsed, err := deploy.ConsumeSecretsFile(opts.SecretsFile)
		if err != nil {
			return nil, &deployFailure{Status: http.StatusBadRequest, Err: err}
		}
		secrets = parsed
	}
	key := opts.Name + "/" + opts.Env
	wasRunning := s.runner.Running(key)

	res, err := deploy.RunImage(deploy.ImageOptions{
		Root: s.root, Name: opts.Name, Env: opts.Env, Domains: opts.Domains,
		BaseDomain: s.store.BaseDomain(), Image: opts.Image,
		ContainerPort: opts.ContainerPort, HealthPath: opts.HealthPath, Secrets: secrets,
	}, s.store)
	if err != nil {
		return nil, &deployFailure{Status: http.StatusBadRequest, Err: err, Detail: map[string]any{"running": wasRunning}}
	}

	if wasRunning {
		err = s.replace(res.App)
	} else {
		err = s.start(res.App)
	}
	if err != nil {
		if res.Redeploy {
			if restoreErr := s.store.Upsert(res.Previous); restoreErr != nil {
				s.log.Error("image deploy failed and the previous record could not be restored", "app", key, "err", restoreErr)
			}
		}
		return nil, &deployFailure{Status: http.StatusBadGateway,
			Err:    fmt.Errorf("%s did not become ready on %s: %w", key, opts.Image, err),
			Detail: map[string]any{"running": wasRunning}}
	}
	if s.tls != nil {
		if err := s.tls.Manage(ctx, res.App.Domains); err != nil {
			s.log.Error("certificate for new domain failed", "domains", res.App.Domains, "err", err)
		}
	}
	app, _ := s.store.Get(key)
	return &app, nil
}
