package connector

/*
Inventory is everything this machine can say about itself in one frame: the
host in absolute units, and one row per instance it supervises.

Part of wire format v1, not a version of its own. There is no fleet in the
field to negotiate with, and an older Bay that never sends this reads to Lore
exactly like a machine that has not reported yet, which is a state the console
needs anyway.

The rows are the derived facts `bay status --json` already computes, plus the
raw ones it does not render. What stays OFF the wire is every rendered
duration ("3d", "12m"): Lore renders those from the timestamps in the viewer's
locale, and a duration frozen at push time would age on the page.
*/
type Inventory struct {
	Type string         `json:"type"`
	At   string         `json:"at"`
	Host Host           `json:"host"`
	Apps []InventoryApp `json:"apps"`
	// Stacks lists every stack environment; their members are rows of Apps
	// carrying `stack` and `service`. Additive: a Lore that does not know
	// stacks strips it.
	Stacks []InventoryStack `json:"stacks,omitempty"`
}

// InventoryStack is one stack environment as the machine sees it.
type InventoryStack struct {
	Stack      string `json:"stack"`
	Env        string `json:"env"`
	Revision   int    `json:"revision"`
	Stopped    bool   `json:"stopped,omitempty"`
	BaseDomain string `json:"baseDomain,omitempty"`
	// TCP lists the public TCP ports it opened (x-lore.tcp).
	TCP []int `json:"tcp,omitempty"`
}

/*
InventoryApp is one instance as the machine sees it.

⚠️ Truth and intent are two columns. `running` and `state` are what systemd
reports right now; `stopped` is what somebody asked for and it is persisted.
`inactive` with `stopped` is a stop on purpose, `inactive` without it is a
process nobody asked to stop, and `failed` is a crash past its restart limit.
Collapsing them would make the console say "stopped" about an app that died.

⚠️ Every field the supervisor might not know is a pointer. `runner.Usage` is
legitimately nil for an unsupervised child process or an app that is not
running, and a zero there reads as a measurement: "0 restarts" is a claim,
absent is the truth.

`problems` travel verbatim and are shown verbatim, as the machine's own
report. Turning them into codes would mean changing `bay status --json`, whose
output is pinned; Lore draws its own localized badges from the booleans beside
them.

`runtime` is carried and never branched on, so a Docker instance renders the
day Bay ships that runner, with no schema change on either side.
*/
type InventoryApp struct {
	App     string   `json:"app"`
	Env     string   `json:"env"`
	Runtime string   `json:"runtime,omitempty"`
	Release string   `json:"release,omitempty"`
	Port    int      `json:"port,omitempty"`
	Domains []string `json:"domains,omitempty"`

	Running bool   `json:"running"`
	State   string `json:"state,omitempty"`
	Stopped bool   `json:"stopped,omitempty"`
	Static  bool   `json:"static,omitempty"`

	Restarts    *int     `json:"restarts,omitempty"`
	StartedAt   string   `json:"startedAt,omitempty"`
	MemoryBytes *int64   `json:"memoryBytes,omitempty"`
	CPUSeconds  *float64 `json:"cpuSeconds,omitempty"`
	Tasks       *int     `json:"tasks,omitempty"`

	Backups         bool   `json:"backups"`
	LastBackupAt    string `json:"lastBackupAt,omitempty"`
	BackupStale     bool   `json:"backupStale,omitempty"`
	LastBackupError string `json:"lastBackupError,omitempty"`

	LastRequestAt string `json:"lastRequestAt,omitempty"`
	Crons         int    `json:"crons,omitempty"`

	Problems []string `json:"problems"`

	// Stack, Service and ServiceKind are set on a stack member: the row is
	// service Service of Stack/Env, run by Bay ("app") or Compose ("service").
	Stack       string `json:"stack,omitempty"`
	Service     string `json:"service,omitempty"`
	ServiceKind string `json:"serviceKind,omitempty"`
}
