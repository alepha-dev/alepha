package runner

import (
	"encoding/json"
	"strings"
	"testing"
)

func adoptSpec() Spec {
	return Spec{
		Key:     "lore/production",
		Runtime: "node",
		Entry:   "index.node.js",
		Env:     map[string]string{"B": "2", "A": "1", "C": "3"},
		Sandbox: Container{Image: "node:26-slim", WorkDir: "/app", Port: 4100,
			Mounts: []Mount{{Source: "/srv/r1", Target: "/app", ReadOnly: true}}},
	}
}

func TestSpecHash(t *testing.T) {
	t.Run("the same spec hashes the same, whatever order its environment is walked in", func(t *testing.T) {
		want, err := SpecHash(adoptSpec())
		if err != nil || len(want) != 64 {
			t.Fatalf("hash = %q, err = %v", want, err)
		}
		// Map iteration order is random per run of a range, so a hash that
		// depended on it would differ somewhere in a hundred renders.
		for i := 0; i < 100; i++ {
			if got, _ := SpecHash(adoptSpec()); got != want {
				t.Fatalf("render %d hashed %s, want %s", i, got, want)
			}
		}
	})

	t.Run("anything Bay would send Docker differently changes it", func(t *testing.T) {
		base, _ := SpecHash(adoptSpec())
		changes := map[string]func(*Spec, *Container){
			"an env value":  func(s *Spec, _ *Container) { s.Env["A"] = "other" },
			"the image":     func(_ *Spec, c *Container) { c.Image = "node:26-slim@sha256:abc" },
			"the release":   func(_ *Spec, c *Container) { c.Mounts[0].Source = "/srv/r2" },
			"the host port": func(_ *Spec, c *Container) { c.HostPort = 4733 },
			"the memory":    func(_ *Spec, c *Container) { c.MemoryBytes = 1 << 30 },
		}
		for name, change := range changes {
			spec := adoptSpec()
			c := spec.Sandbox.(Container)
			change(&spec, &c)
			spec.Sandbox = c
			if got, _ := SpecHash(spec); got == base {
				t.Fatalf("%s did not change the hash", name)
			}
		}
	})

	t.Run("registry credentials are not part of it: they are sent with a pull, never to a container", func(t *testing.T) {
		base, _ := SpecHash(adoptSpec())
		spec := adoptSpec()
		c := spec.Sandbox.(Container)
		c.RegistryAuth = "secret"
		spec.Sandbox = c
		if got, _ := SpecHash(spec); got != base {
			t.Fatal("the hash moved with the registry auth")
		}
	})

	t.Run("the label is stamped on what is created, and is the hash of the body without it", func(t *testing.T) {
		for _, candidate := range []bool{false, true} {
			d, engine := startFakeEngine(t, func(r fakeRequest) (int, string) {
				if r.Method == "DELETE" || strings.HasSuffix(r.Path, "/stop") {
					return 404, `{"message":"No such container"}`
				}
				return 200, ""
			})
			spec := adoptSpec()
			var err error
			if candidate {
				c := spec.Sandbox.(Container)
				c.HostPort = 4733
				spec.Sandbox = c
				err = d.StartCandidate(spec)
			} else {
				err = d.Start(spec)
			}
			if err != nil {
				t.Fatal(err)
			}
			var create fakeRequest
			for _, call := range engine.calls() {
				if call.Path == "/containers/create" {
					create = call
				}
			}
			labels := create.Body["Labels"].(map[string]any)
			want, _ := SpecHash(spec)
			if labels[dockerSpecLabel] != want {
				t.Fatalf("candidate=%v: label = %v, want %s", candidate, labels[dockerSpecLabel], want)
			}
			if labels[dockerKeyLabel] != "lore/production" {
				t.Fatalf("the key label went missing: %v", labels)
			}
			// The proof that the label is excluded: taking it back out of what
			// Docker received hashes to the label itself.
			delete(labels, dockerSpecLabel)
			raw, _ := json.Marshal(create.Body)
			var body map[string]any
			_ = json.Unmarshal(raw, &body)
			if got, _ := hashBody(body); got != want {
				t.Fatalf("candidate=%v: the body without the label hashes to %s, want %s", candidate, got, want)
			}
		}
	})

	t.Run("createBody itself carries no spec label", func(t *testing.T) {
		spec := adoptSpec()
		labels := createBody(spec, spec.Sandbox.(Container))["Labels"].(map[string]string)
		if _, has := labels[dockerSpecLabel]; has {
			t.Fatal("createBody must stay the function the hash is taken of")
		}
	})
}

func TestAdoptable(t *testing.T) {
	hash, _ := SpecHash(adoptSpec())
	container := func(state, label, image string) string {
		labels := `{"dev.alepha.bay.key":"lore/production"}`
		if label != "" {
			labels = `{"dev.alepha.bay.key":"lore/production","dev.alepha.bay.spec":"` + label + `"}`
		}
		return `{"Image":"` + image + `","State":` + state + `,"Config":{"Labels":` + labels + `}}`
	}
	const running = `{"Running":true,"Restarting":false}`
	engineWith := func(containerStatus int, containerBody string, imageStatus int, imageBody string) *Docker {
		d, _ := startFakeEngine(t, func(r fakeRequest) (int, string) {
			if strings.HasPrefix(r.Path, "/containers/") {
				return containerStatus, containerBody
			}
			return imageStatus, imageBody
		})
		return d
	}

	cases := []struct {
		name string
		d    *Docker
		want string
	}{
		{"same hash, same image, running: adopted",
			engineWith(200, container(running, hash, "sha256:aaa"), 200, `{"Id":"sha256:aaa"}`), ""},
		{"no container",
			engineWith(404, `{"message":"No such container"}`, 200, `{"Id":"sha256:aaa"}`), NotRunning},
		{"a stopped container",
			engineWith(200, container(`{"Running":false}`, hash, "sha256:aaa"), 200, `{"Id":"sha256:aaa"}`), NotRunning},
		{"a container in a restart loop",
			engineWith(200, container(`{"Running":true,"Restarting":true}`, hash, "sha256:aaa"), 200, `{"Id":"sha256:aaa"}`), NotRunning},
		{"a container created before the label existed",
			engineWith(200, container(running, "", "sha256:aaa"), 200, `{"Id":"sha256:aaa"}`), NoLabel},
		{"a container created from another definition",
			engineWith(200, container(running, strings.Repeat("0", 64), "sha256:aaa"), 200, `{"Id":"sha256:aaa"}`), SpecChanged},
		{"the tag was pulled again since",
			engineWith(200, container(running, hash, "sha256:aaa"), 200, `{"Id":"sha256:bbb"}`), ImageChanged},
		{"the image is gone from the host",
			engineWith(200, container(running, hash, "sha256:aaa"), 404, `{"message":"No such image"}`), ImageChanged},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.d.Adoptable(adoptSpec()); got != tc.want {
				t.Fatalf("reason = %q, want %q", got, tc.want)
			}
		})
	}

	t.Run("a spec the runner cannot run is never adopted", func(t *testing.T) {
		d := engineWith(200, container(running, hash, "sha256:aaa"), 200, `{"Id":"sha256:aaa"}`)
		if got := d.Adoptable(Spec{Key: "lore/production"}); got == "" {
			t.Fatal("adopted a spec with no container")
		}
	})
}
