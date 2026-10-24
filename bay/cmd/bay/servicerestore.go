package main

import (
	"errors"
	"fmt"
	"net/http"
	neturl "net/url"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/state"
)

const notConfigured = "backups are not configured: run `bay config s3:backups --endpoint URL --bucket NAME` with BAY_S3_ACCESS_KEY and BAY_S3_SECRET_KEY set"

// handleStackBackups lists the stored dumps of a stack environment's services.
func (s *server) handleStackBackups(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	if _, found := s.store.StackEnv(name, env); !found {
		writeError(w, http.StatusNotFound, "unknown stack environment "+name+"/"+env)
		return
	}
	mgr, _, err := s.backupManager()
	if err != nil || mgr == nil {
		writeError(w, http.StatusPreconditionFailed, notConfigured)
		return
	}
	only := r.URL.Query().Get("service")
	out := []map[string]any{}
	for _, m := range s.store.StackMembers(name, env) {
		if m.BackupHook == nil || (only != "" && m.Service != only) {
			continue
		}
		entries, err := mgr.List(r.Context(), m.Name, m.Env)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		for _, e := range entries {
			out = append(out, map[string]any{"service": m.Service, "backup": path.Base(e.Key), "key": e.Key,
				"at": e.Timestamp.Format(time.RFC3339), "storedBytes": e.Size})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i]["service"].(string) < out[j]["service"].(string) })
	writeJSON(w, http.StatusOK, out)
}

/*
restoreKey resolves the backup a restore names into its object key, and
refuses one taken from another stack environment unless `from` names that
environment: restoring production's data into staging is a deliberate act,
never what a pasted key does by accident.

The backup is given as its file name (`20261024T120000Z.dump.gz`) or its
whole key; either way it must sit under the prefix of the service in the
environment it came from.
*/
func restoreKey(stackName, env, service, backup, from string) (string, error) {
	srcStack, srcEnv := stackName, env
	if from != "" {
		var err error
		if srcStack, srcEnv, err = stackKeyOf(from); err != nil {
			return "", fmt.Errorf("--from: %w", err)
		}
	}
	prefix := "apps/" + naming.Instance(state.MemberName(srcStack, service), srcEnv) + "/db/"
	if !strings.Contains(backup, "/") {
		backup = prefix + backup
	}
	if !strings.HasPrefix(backup, prefix) || strings.Contains(strings.TrimPrefix(backup, prefix), "/") {
		if from == "" {
			return "", fmt.Errorf("%s is not a backup of %s in %s/%s; restoring another environment's data takes --from <stack>/<env>",
				backup, service, stackName, env)
		}
		return "", fmt.Errorf("%s is not a backup of %s in %s", backup, service, from)
	}
	if !strings.HasSuffix(backup, ".dump.gz") {
		return "", fmt.Errorf("%s is not a service dump", backup)
	}
	return backup, nil
}

/*
handleStackRestore replays a listed dump into a service.

It asks for `confirm=<stack>/<env>/<service>`: a restore overwrites live data,
so the caller names exactly what it overwrites. The dump is downloaded and
verified before anything is touched. Then the stack's app services are parked
so nothing writes during the replay, the dump is replayed into the running
service (pg_restore needs its server up, and so does a mongorestore), and the
apps come back.
*/
func (s *server) handleStackRestore(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	service := q.Get("service")
	member, found := s.store.Get(memberKey(name, env, service))
	if !found {
		writeError(w, http.StatusNotFound, name+"/"+env+" has no service "+service)
		return
	}
	if member.BackupHook == nil {
		writeError(w, http.StatusPreconditionFailed, service+" declares no x-lore.backup, so there is nothing to restore it from")
		return
	}
	if member.BackupHook.PostgresDB == "" && member.BackupHook.Restore == "" {
		writeError(w, http.StatusPreconditionFailed, service+"'s backup hook declares no restore command: add x-lore.backup.restore")
		return
	}
	target := name + "/" + env + "/" + service
	if q.Get("confirm") != target {
		writeError(w, http.StatusPreconditionRequired, "a restore overwrites the data of "+target+"; confirm it by naming it")
		return
	}
	if se, _ := s.store.StackEnv(name, env); se.Stopped {
		writeError(w, http.StatusConflict, name+"/"+env+" is stopped: start it before restoring into it")
		return
	}
	key, err := restoreKey(name, env, service, q.Get("backup"), q.Get("from"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	mgr, _, err := s.backupManager()
	if err != nil || mgr == nil {
		writeError(w, http.StatusPreconditionFailed, notConfigured)
		return
	}
	defer lockStack(name, env)()
	defer s.lockBackup(member.Key())()

	dumper := serviceDumper{container: runner.ContainerName(member.Key()), hook: *member.BackupHook}
	dump, err := mgr.FetchDump(r.Context(), key, dumper)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var parked []state.App
	for _, m := range s.store.StackMembers(name, env) {
		if m.ServiceKind != "app" || m.Release == "" || m.Stopped {
			continue
		}
		release := s.holdDuring(m.Key())
		defer release()
		if err := s.runner.Stop(m.Key(), stopGrace); err != nil {
			writeError(w, http.StatusInternalServerError, "stop "+m.Service+": "+err.Error())
			return
		}
		parked = append(parked, m)
	}
	restoreErr := dumper.Restore(r.Context(), dump)
	var notBack []string
	for _, m := range parked {
		if err := s.start(m); err != nil {
			notBack = append(notBack, m.Service+": "+err.Error())
		}
	}
	if restoreErr != nil {
		writeError(w, http.StatusInternalServerError, "restore: "+restoreErr.Error(), map[string]any{"appsNotBack": notBack})
		return
	}
	if len(notBack) > 0 {
		writeError(w, http.StatusBadGateway, "restored, but an app did not come back", map[string]any{"restored": key, "appsNotBack": notBack})
		return
	}
	s.log.Info("service restored", "service", target, "key", key)
	writeJSON(w, http.StatusOK, map[string]any{"restored": key, "into": target,
		"notRestored": serviceNotBackedUp(member)})
}

// cmdStackBackup is `bay backup list|restore <stack>/<env> ...`.
func cmdStackBackup(verb string, args []string) error {
	const usage = "usage: bay backup list <stack>/<env> [service]\n       bay backup restore <stack>/<env> <service> <backup> [--from <stack>/<env>] [--yes]"
	if len(args) < 1 {
		return errors.New(usage)
	}
	name, env, err := stackKeyOf(args[0])
	if err != nil {
		return err
	}
	base := controlHost + "/stacks/" + name + "/" + env
	if verb == "list" {
		query := ""
		if len(args) > 1 {
			query = "?service=" + neturl.QueryEscape(args[1])
		}
		res, err := call(http.MethodGet, base+"/backups"+query, nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
		return nil
	}
	if len(args) < 3 {
		return errors.New(usage)
	}
	service, backup := args[1], args[2]
	from, yes := "", false
	for i := 3; i < len(args); i++ {
		switch {
		case args[i] == "--yes":
			yes = true
		case args[i] == "--from" && i+1 < len(args):
			from = args[i+1]
			i++
		default:
			return fmt.Errorf("unknown argument %s\n%s", args[i], usage)
		}
	}
	target := name + "/" + env + "/" + service
	if !yes {
		fmt.Fprintf(os.Stderr, "This overwrites the data of %s with %s. Type %s to confirm: ", target, backup, target)
		var typed string
		_, _ = fmt.Scanln(&typed)
		if strings.TrimSpace(typed) != target {
			return errors.New("not confirmed; nothing was restored")
		}
	}
	query := neturl.Values{"service": {service}, "backup": {backup}, "confirm": {target}}
	if from != "" {
		query.Set("from", from)
	}
	res, err := call(http.MethodPost, base+"/restore?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}
