package runner

import "strings"

/*
ContainerName is the name of an instance's container: "lore/production" is
"bay-lore-production".

Not injective, on purpose kept readable: "demo-staging/eu" and
"demo/staging-eu" share one name, so a deploy refuses a key whose container
name another instance already holds (deploy.Run, deploy.RunImage). A shared
name would make two instances replace each other's container.
*/
func ContainerName(key string) string {
	return "bay-" + strings.ReplaceAll(key, "/", "-")
}

func unitName(key string) string { return ContainerName(key) }
