package stack

import "sort"

/*
VolumeMounts maps each named volume of the stack to the services that mount
it, from the normalised model. Bind mounts and anonymous volumes are not
named volumes and are left out: a bind mount is a file the bundle carries,
and an anonymous volume is scratch Compose recreates.
*/
func (l *Loaded) VolumeMounts() map[string][]string {
	out := map[string][]string{}
	if top, ok := l.Model["volumes"].(map[string]any); ok {
		for name := range top {
			out[name] = nil
		}
	}
	services, _ := l.Model["services"].(map[string]any)
	for _, name := range l.Services {
		svc, _ := services[name].(map[string]any)
		mounts, _ := svc["volumes"].([]any)
		for _, m := range mounts {
			mm, _ := m.(map[string]any)
			source, _ := mm["source"].(string)
			if mm["type"] != "volume" || source == "" {
				continue
			}
			if _, named := out[source]; named {
				out[source] = append(out[source], name)
			}
		}
	}
	for v := range out {
		sort.Strings(out[v])
	}
	return out
}
