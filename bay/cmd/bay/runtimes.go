package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/alepha-dev/bay/internal/manifest"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/runtimes"
	"github.com/alepha-dev/bay/internal/state"
)

/*
runtimeSelection is the image an instance runs on: its own override, else the
image for its manifest's runtime and major, at the digest `bay runtimes update`
last resolved or the one this Bay release pins.

Read from the release being served, so it describes what a start would run
now, not what the instance was first deployed with.
*/
func (s *server) runtimeSelection(app state.App) (runtimes.Selection, error) {
	instance := filepath.Join(s.root, "apps", naming.Instance(app.Name, app.Env))
	m, err := manifest.LoadFromRelease(filepath.Join(instance, "current"))
	if err != nil {
		return runtimes.Selection{}, err
	}
	return runtimes.Select(m.Runtime, m.RuntimeVersion, app.RuntimeImage, s.store.RuntimeLocks())
}

// runtimeImageRow is one pinned image in `bay runtimes`.
type runtimeImageRow struct {
	Runtime string `json:"runtime"`
	Major   string `json:"major"`
	Tag     string `json:"tag"`
	// Ref is what an instance on this image runs: the refreshed digest when
	// `bay runtimes update` resolved one, the release's pin otherwise.
	Ref       string `json:"ref"`
	Refreshed bool   `json:"refreshed"`
}

// runtimeInstanceRow is one instance in `bay runtimes`.
type runtimeInstanceRow struct {
	Key      string `json:"key"`
	Image    string `json:"image,omitempty"`
	Override bool   `json:"override,omitempty"`
	Warning  string `json:"warning,omitempty"`
	Error    string `json:"error,omitempty"`
}

type runtimesReport struct {
	Images    []runtimeImageRow    `json:"images"`
	Instances []runtimeInstanceRow `json:"instances"`
}

func (s *server) runtimesReport() runtimesReport {
	locks := s.store.RuntimeLocks()
	var report runtimesReport
	for _, img := range runtimes.Images {
		row := runtimeImageRow{Runtime: img.Runtime, Major: img.Major, Tag: img.Tag, Ref: img.Ref()}
		if locked := locks[img.Tag]; locked != "" {
			row.Ref, row.Refreshed = locked, true
		}
		report.Images = append(report.Images, row)
	}
	for _, app := range s.store.Apps() {
		if app.Static {
			continue
		}
		row := runtimeInstanceRow{Key: app.Key()}
		if sel, err := s.runtimeSelection(app); err != nil {
			row.Error = err.Error()
		} else {
			row.Image, row.Override, row.Warning = sel.Ref, sel.Override, sel.Warning
		}
		report.Instances = append(report.Instances, row)
	}
	return report
}

// runtimesUpdate is the answer to `bay runtimes update`.
type runtimesUpdate struct {
	// Moved lists the tags whose digest changed, as "tag: old -> new".
	Moved []string `json:"moved"`
	// Restarted and Failed name the instances the move applied to.
	Restarted []string `json:"restarted"`
	Failed    []string `json:"failed,omitempty"`
	// Pending explains why instances were not restarted, when they were not.
	Pending string `json:"pending,omitempty"`
}

/*
updateRuntimes re-resolves every pinned tag to its newest digest, records the
ones that moved, and restarts the running instances whose image moved.

Every tag is pulled before any instance is touched, so a restart never waits
on a registry, and a registry that fails halfway leaves every instance on what
it had. An instance with an image of its own is left alone: whoever set it
owns its updates.
*/
func (s *server) updateRuntimes() (runtimesUpdate, error) {
	docker, err := runner.NewDocker("")
	if err != nil {
		return runtimesUpdate{}, err
	}
	before := map[string]string{}
	for _, app := range s.store.Apps() {
		if sel, err := s.runtimeSelection(app); err == nil && !app.Static && !sel.Override {
			before[app.Key()] = sel.Ref
		}
	}

	locks := s.store.RuntimeLocks()
	resolved := map[string]string{}
	for _, img := range runtimes.Images {
		ref, err := docker.ResolveDigest(img.Tag)
		if err != nil {
			return runtimesUpdate{}, err
		}
		resolved[img.Tag] = ref
	}
	var result runtimesUpdate
	for _, img := range runtimes.Images {
		current := locks[img.Tag]
		if current == "" {
			current = img.Ref()
		}
		if resolved[img.Tag] == current {
			continue
		}
		if err := s.store.SetRuntimeLock(img.Tag, resolved[img.Tag]); err != nil {
			return result, err
		}
		result.Moved = append(result.Moved, img.Tag+": "+digestOf(current)+" -> "+digestOf(resolved[img.Tag]))
	}

	if _, onDocker := s.runner.(*runner.Docker); !onDocker {
		if len(result.Moved) > 0 {
			result.Pending = "this Bay still supervises apps outside Docker; they pick the new images up once they run in containers"
		}
		return result, nil
	}
	for _, app := range s.store.Apps() {
		old, tracked := before[app.Key()]
		if !tracked || !s.runner.Running(app.Key()) {
			continue
		}
		sel, err := s.runtimeSelection(app)
		if err != nil || sel.Ref == old {
			continue
		}
		if err := s.restartInstance(app); err != nil {
			result.Failed = append(result.Failed, app.Key()+": "+err.Error())
			continue
		}
		result.Restarted = append(result.Restarted, app.Key())
	}
	return result, nil
}

/*
restartInstance stops and starts one instance with requests held, the same
sequence the connector's restart verb runs.
*/
func (s *server) restartInstance(app state.App) error {
	return s.restart(app)
}

// digestOf shortens a reference to its digest's first 12 hex characters.
func digestOf(ref string) string {
	_, digest, ok := strings.Cut(ref, "@sha256:")
	if !ok || len(digest) < 12 {
		return ref
	}
	return digest[:12]
}

func (s *server) handleRuntimes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.runtimesReport())
}

func (s *server) handleRuntimesUpdate(w http.ResponseWriter, _ *http.Request) {
	result, err := s.updateRuntimes()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

/*
handleRuntimeImage sets or clears an instance's own image. Recorded only: it
takes effect at the instance's next start or deploy, like `bay env set` would
if it did not restart, because swapping a runtime under a running app is a
decision the operator makes with `bay stop` / `bay start` in hand.
*/
func (s *server) handleRuntimeImage(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("name") + "/" + r.PathValue("env")
	var body struct {
		Image string `json:"image"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "body must be {\"image\": \"...\"}")
		return
	}
	if strings.ContainsAny(body.Image, " \t\n") {
		writeError(w, http.StatusBadRequest, "an image reference has no whitespace")
		return
	}
	if err := s.store.SetRuntimeImage(key, body.Image); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"instance": key, "image": body.Image})
}

/*
cmdRuntimes is `bay runtimes`:

	bay runtimes                         # the pinned images, and what each instance runs
	bay runtimes update                  # pull newer digests, restart instances that moved
	bay runtimes set <name/env> <image>  # an instance's own image, from its next start
	bay runtimes clear <name/env>        # back to the image Bay picks
*/
func cmdRuntimes(args []string) error {
	sub := ""
	if len(args) > 0 {
		sub = args[0]
	}
	switch sub {
	case "":
		raw, err := call(http.MethodGet, controlHost+"/runtimes", nil)
		if err != nil {
			return err
		}
		var report runtimesReport
		if err := json.Unmarshal([]byte(raw), &report); err != nil {
			return fmt.Errorf("parse control api response: %w", err)
		}
		printRuntimes(report)
		return nil
	case "update":
		raw, err := call(http.MethodPost, controlHost+"/runtimes/update", nil)
		if err != nil {
			return err
		}
		var result runtimesUpdate
		if err := json.Unmarshal([]byte(raw), &result); err != nil {
			return fmt.Errorf("parse control api response: %w", err)
		}
		printRuntimesUpdate(result)
		if len(result.Failed) > 0 {
			return fmt.Errorf("%d instance(s) did not come back on the new image", len(result.Failed))
		}
		return nil
	case "set", "clear":
		if len(args) < 2 || (sub == "set" && len(args) < 3) {
			return errors.New("usage: bay runtimes set <name/env> <image> | bay runtimes clear <name/env>")
		}
		key, err := instanceKey(args[1:], "runtimes "+sub)
		if err != nil {
			return err
		}
		image := ""
		if sub == "set" {
			image = args[2]
		}
		body, _ := json.Marshal(map[string]string{"image": image})
		res, err := call(http.MethodPut, controlHost+"/apps/"+key+"/runtime-image", strings.NewReader(string(body)))
		if err != nil {
			return err
		}
		fmt.Println(res)
		fmt.Println("takes effect at the next start or deploy of " + key)
		return nil
	default:
		return errors.New("usage: bay runtimes [update | set <name/env> <image> | clear <name/env>]")
	}
}

func printRuntimes(report runtimesReport) {
	fmt.Println("images")
	for _, img := range report.Images {
		note := "pinned by this Bay release"
		if img.Refreshed {
			note = "refreshed by bay runtimes update"
		}
		fmt.Printf("  %-6s %-4s %s  (%s)\n", img.Runtime, img.Major, img.Ref, note)
	}
	if len(report.Instances) == 0 {
		return
	}
	fmt.Println("instances")
	for _, inst := range report.Instances {
		switch {
		case inst.Error != "":
			fmt.Printf("  %s  ? %s\n", inst.Key, inst.Error)
		case inst.Override:
			fmt.Printf("  %s  %s  (set by hand; bay runtimes update leaves it alone)\n", inst.Key, inst.Image)
		default:
			fmt.Printf("  %s  %s\n", inst.Key, inst.Image)
		}
		if inst.Warning != "" {
			fmt.Printf("    ⚠ %s\n", inst.Warning)
		}
	}
}

func printRuntimesUpdate(result runtimesUpdate) {
	if len(result.Moved) == 0 {
		fmt.Println("every runtime image is already at its newest digest")
		return
	}
	for _, m := range result.Moved {
		fmt.Println("moved      " + m)
	}
	for _, k := range result.Restarted {
		fmt.Println("restarted  " + k)
	}
	for _, f := range result.Failed {
		fmt.Println("FAILED     " + f)
	}
	if result.Pending != "" {
		fmt.Println(result.Pending)
	}
}
