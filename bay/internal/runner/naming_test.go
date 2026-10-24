package runner

import "testing"

func TestContainerName(t *testing.T) {
	t.Run("reads as the instance key", func(t *testing.T) {
		if got := ContainerName("lore/production"); got != "bay-lore-production" {
			t.Fatalf("name = %q", got)
		}
	})

	t.Run("two keys that differ only by where the separator sits share a name", func(t *testing.T) {
		if ContainerName("demo-staging/eu") != ContainerName("demo/staging-eu") {
			t.Fatal("expected the collision deploy refuses")
		}
	})
}
