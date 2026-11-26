package connector

import (
	"context"
	"reflect"
	"testing"
)

// The reader is asked once for every domain the apps serve, stack members
// included, each once and sorted (#Q4441), and its answer is what the host
// block carries.
func TestCertificatesReadTheServedDomains(t *testing.T) {
	var asked []string
	c := &Client{Certificates: func(_ context.Context, domains []string) []CertificateState {
		asked = domains
		return []CertificateState{{Domain: "a.example.com", NotAfter: "2027-01-01T00:00:00Z", Issuer: "R11"}}
	}}
	inv := Inventory{Apps: []InventoryApp{
		{App: "web", Domains: []string{"b.example.com", "a.example.com"}},
		{App: "api", Stack: "shop", Service: "api", Domains: []string{"a.example.com", "c.example.com"}},
		{App: "worker"},
	}}

	got := c.certificates(context.Background(), inv)

	if want := []string{"a.example.com", "b.example.com", "c.example.com"}; !reflect.DeepEqual(asked, want) {
		t.Fatalf("asked %v, want %v", asked, want)
	}
	if len(got) != 1 || got[0].Domain != "a.example.com" {
		t.Fatalf("certificates %+v", got)
	}
}

// No reader (a Bay without --tls, or `bay agent`) or no domain reads nothing,
// and the key stays off the wire.
func TestCertificatesAbsentWithoutReaderOrDomain(t *testing.T) {
	inv := Inventory{Apps: []InventoryApp{{App: "web", Domains: []string{"a.example.com"}}}}
	if got := (&Client{}).certificates(context.Background(), inv); got != nil {
		t.Fatalf("no reader read %+v", got)
	}
	called := false
	c := &Client{Certificates: func(context.Context, []string) []CertificateState {
		called = true
		return nil
	}}
	if got := c.certificates(context.Background(), Inventory{Apps: []InventoryApp{{App: "worker"}}}); got != nil || called {
		t.Fatalf("no domain still read: %+v, called %v", got, called)
	}
}
