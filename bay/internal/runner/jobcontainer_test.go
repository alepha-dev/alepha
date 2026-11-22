package runner

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"strings"
	"testing"
)

// The job container is hardened by construction (#Q3999): nothing in
// JobContainer can mount the host, the socket, or keep a capability.
func TestJobContainerIsHardened(t *testing.T) {
	body := jobCreateBody(JobContainer{
		Name: "bay-job-1-claude", Image: "ghcr.io/x/agent@sha256:" + strings.Repeat("a", 64),
		Cmd: []string{"claude", "-p", "x"}, Workspace: "bay-job-1", Cache: "bay-job-cache-1",
		Network: "bay-job-1", MemoryBytes: 1 << 30, PidsLimit: 512, Runtime: "runsc",
		Hosts: []string{"egress:172.30.0.2"},
	})
	raw, _ := json.Marshal(body)
	text := string(raw)
	if strings.Contains(text, "docker.sock") || strings.Contains(text, `"bind"`) || strings.Contains(text, "Binds") {
		t.Fatalf("a job container mounts the host: %s", text)
	}
	host := body["HostConfig"].(map[string]any)
	if caps := host["CapDrop"].([]string); len(caps) != 1 || caps[0] != "ALL" {
		t.Fatalf("CapDrop = %v", caps)
	}
	if host["ReadonlyRootfs"] != true || host["Privileged"] != nil {
		t.Fatalf("root filesystem writable or privileged: %v", host)
	}
	if opts := host["SecurityOpt"].([]string); opts[0] != "no-new-privileges:true" {
		t.Fatalf("SecurityOpt = %v", opts)
	}
	if host["NetworkMode"] != "bay-job-1" || host["Memory"] != int64(1<<30) || host["PidsLimit"] != int64(512) || host["Runtime"] != "runsc" {
		t.Fatalf("network or limits wrong: %v", host)
	}
	if hosts, _ := host["ExtraHosts"].([]string); len(hosts) != 1 || hosts[0] != "egress:172.30.0.2" {
		t.Fatalf("ExtraHosts = %v, want the egress proxy's line", host["ExtraHosts"])
	}
	if body["User"] != JobUser {
		t.Fatalf("user = %v, want the image's non-root user", body["User"])
	}
	mounts := host["Mounts"].([]map[string]any)
	if len(mounts) != 2 || mounts[0]["Type"] != "volume" || mounts[1]["Target"] != JobCachePath {
		t.Fatalf("mounts = %v", mounts)
	}
	// No network named is no network at all, never the default bridge.
	if jobCreateBody(JobContainer{Workspace: "w"})["HostConfig"].(map[string]any)["NetworkMode"] != "none" {
		t.Fatal("an unnamed network fell back to something reachable")
	}
}

func TestDemuxSplitsTheStreams(t *testing.T) {
	var raw bytes.Buffer
	frame := func(stream byte, text string) {
		header := make([]byte, 8)
		header[0] = stream
		binary.BigEndian.PutUint32(header[4:], uint32(len(text)))
		raw.Write(header)
		raw.WriteString(text)
	}
	frame(1, "out one\n")
	frame(2, "err one\n")
	frame(1, "out two\n")
	var out, errs bytes.Buffer
	if err := demuxTo(&raw, &out, &errs); err != nil {
		t.Fatal(err)
	}
	if out.String() != "out one\nout two\n" || errs.String() != "err one\n" {
		t.Fatalf("stdout %q stderr %q", out.String(), errs.String())
	}
}
