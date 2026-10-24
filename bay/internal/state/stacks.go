package state

import (
	"fmt"
	"sort"
)

/*
Stack is a group of apps and services described by one compose file (epic
E74), with one or more environments running on this Bay.
*/
type Stack struct {
	Name string     `json:"name"`
	Envs []StackEnv `json:"envs"`
}

/*
StackEnv is one running copy of a stack: `umami/production`, `umami/staging`.
Each has its own Compose project, network, volumes, variables and routes.
*/
type StackEnv struct {
	Env string `json:"env"`
	// BaseDomain is what route labels resolve against: `@` is this domain,
	// `auth` is `auth.<this>`. Defaults to `<stack>[-<env>].<Bay's base>`.
	BaseDomain string `json:"baseDomain,omitempty"`
	// Revision is the number of the revision applied, 0 before the first.
	Revision int `json:"revision"`
	// Revisions lists every revision kept, oldest first.
	Revisions []StackRevision `json:"revisions,omitempty"`
	// Routes are the environment's full-domain routes: how an unmodified
	// compose file gets routed, and how staging and production get different
	// domains.
	Routes []StackRoute `json:"routes,omitempty"`
	// HostPorts pins the loopback port each published container port was
	// given, keyed "service:port", so a redeploy keeps every route and every
	// published address where it was.
	HostPorts map[string]int `json:"hostPorts,omitempty"`
	// TCP maps each public port opened for `x-lore.tcp` to the loopback port
	// it forwards to.
	TCP map[int]int `json:"tcp,omitempty"`
	// Stopped is the intent `bay stack stop` records, like App.Stopped.
	Stopped bool `json:"stopped,omitempty"`
}

// StackRevision is one bundle applied to a stack environment.
type StackRevision struct {
	Number int `json:"number"`
	// Digests pins every image the revision resolved at deploy time, by
	// service, so a rollback pulls exactly what ran.
	Digests map[string]string `json:"digests,omitempty"`
	// AppliedAt is when it was applied, RFC3339 UTC.
	AppliedAt string `json:"appliedAt,omitempty"`
}

// StackRoute sends a full domain to a service of the stack environment.
type StackRoute struct {
	Service string `json:"service"`
	Domain  string `json:"domain"`
}

// MemberName is the App name of a stack member: "<stack>.<service>". A dot
// cannot appear in a standalone app's name, so a member never collides with
// one.
func MemberName(stack, service string) string { return stack + "." + service }

// StackEnv returns one environment of a stack.
func (s *Store) StackEnv(stack, env string) (StackEnv, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, st := range s.state.Stacks {
		if st.Name != stack {
			continue
		}
		for _, e := range st.Envs {
			if e.Env == env {
				return copyStackEnv(e), true
			}
		}
	}
	return StackEnv{}, false
}

// Stacks returns a copy of every stack, sorted by name.
func (s *Store) Stacks() []Stack {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Stack, 0, len(s.state.Stacks))
	for _, st := range s.state.Stacks {
		c := Stack{Name: st.Name}
		for _, e := range st.Envs {
			c.Envs = append(c.Envs, copyStackEnv(e))
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

/*
MutateStackEnv applies fn to one stack environment, creating the stack and
the environment when they do not exist, and persists.
*/
func (s *Store) MutateStackEnv(stack, env string, fn func(*StackEnv) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	si := -1
	for i, st := range s.state.Stacks {
		if st.Name == stack {
			si = i
		}
	}
	if si < 0 {
		s.state.Stacks = append(s.state.Stacks, Stack{Name: stack})
		si = len(s.state.Stacks) - 1
	}
	st := &s.state.Stacks[si]
	ei := -1
	for i, e := range st.Envs {
		if e.Env == env {
			ei = i
		}
	}
	if ei < 0 {
		st.Envs = append(st.Envs, StackEnv{Env: env})
		ei = len(st.Envs) - 1
	}
	if err := fn(&st.Envs[ei]); err != nil {
		return err
	}
	return s.flush()
}

/*
RemoveStackEnv forgets a stack environment and every App that is a member of
it, and the stack itself once it has no environment left.
*/
func (s *Store) RemoveStackEnv(stack, env string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	found := false
	for i := range s.state.Stacks {
		st := &s.state.Stacks[i]
		if st.Name != stack {
			continue
		}
		for j, e := range st.Envs {
			if e.Env == env {
				st.Envs = append(st.Envs[:j], st.Envs[j+1:]...)
				found = true
				break
			}
		}
		if len(st.Envs) == 0 {
			s.state.Stacks = append(s.state.Stacks[:i], s.state.Stacks[i+1:]...)
		}
		break
	}
	if !found {
		return fmt.Errorf("unknown stack environment %s/%s", stack, env)
	}
	kept := s.state.Apps[:0]
	for _, a := range s.state.Apps {
		if a.Stack == stack && a.Env == env {
			continue
		}
		kept = append(kept, a)
	}
	s.state.Apps = kept
	return s.flush()
}

// StackMembers lists the Apps of one stack environment.
func (s *Store) StackMembers(stack, env string) []App {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []App
	for _, a := range s.state.Apps {
		if a.Stack == stack && a.Env == env {
			out = append(out, a)
		}
	}
	return out
}

func copyStackEnv(e StackEnv) StackEnv {
	c := e
	c.Revisions = append([]StackRevision(nil), e.Revisions...)
	c.Routes = append([]StackRoute(nil), e.Routes...)
	c.TCP = make(map[int]int, len(e.TCP))
	for k, v := range e.TCP {
		c.TCP[k] = v
	}
	c.HostPorts = make(map[string]int, len(e.HostPorts))
	for k, v := range e.HostPorts {
		c.HostPorts[k] = v
	}
	return c
}
