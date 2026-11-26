package connector

import (
	"context"
	"sort"
)

/*
CertificateState is one served domain's TLS certificate as the inventory
reports it (#Q4441): its domain, its expiry (RFC 3339, UTC) and the CA that
issued it. Bay obtains and renews these itself (ACME), so it reads them from
its store rather than probing anything over the network; Lore lists them on
its certificate tile, which works where Lore cannot open a socket.
*/
type CertificateState struct {
	Domain   string `json:"domain"`
	NotAfter string `json:"notAfter"`
	Issuer   string `json:"issuer,omitempty"`
}

// CertificateReader reads the certificates of the named domains, leaving out
// the ones it holds none for.
type CertificateReader func(ctx context.Context, domains []string) []CertificateState

// maxCertificates bounds the list on the wire, as Lore's schema does.
const maxCertificates = 200

/*
servedDomains is every domain the inventory's apps answer on, stack members
included, each once and sorted, so the certificates read follow a stable
order whatever order the apps came in.
*/
func servedDomains(inv Inventory) []string {
	seen := map[string]bool{}
	var out []string
	for _, app := range inv.Apps {
		for _, domain := range app.Domains {
			if domain == "" || seen[domain] {
				continue
			}
			seen[domain] = true
			out = append(out, domain)
		}
	}
	sort.Strings(out)
	return out
}

// certificates reads the served domains' certificates; nil without a reader
// (a Bay without --tls, or `bay agent`) or with no domain.
func (c *Client) certificates(ctx context.Context, inv Inventory) []CertificateState {
	if c.Certificates == nil {
		return nil
	}
	domains := servedDomains(inv)
	if len(domains) == 0 {
		return nil
	}
	certs := c.Certificates(ctx, domains)
	if len(certs) > maxCertificates {
		certs = certs[:maxCertificates]
	}
	return certs
}
