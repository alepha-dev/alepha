package main

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/egress"
)

const egressUsage = "usage: bay egress-proxy --listen ADDR --allow HOST[,HOST...]"

/*
cmdEgressProxy is `bay egress-proxy`: the forward proxy a container job reaches
the world through (#Q3996). Bay runs it itself, as a job's sidecar; it prints
one JSON line per refused request, which the job's log shows.
*/
func cmdEgressProxy(args []string) error {
	listen, allow := "", ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--listen":
			if i+1 < len(args) {
				listen = args[i+1]
				i++
			}
		case "--allow":
			if i+1 < len(args) {
				allow = args[i+1]
				i++
			}
		default:
			return errors.New(egressUsage)
		}
	}
	if listen == "" {
		return errors.New(egressUsage)
	}
	proxy := egress.New(strings.Split(allow, ","))
	proxy.Refused = egress.LogRefusal(os.Stdout)
	server := &http.Server{Addr: listen, Handler: proxy, ReadHeaderTimeout: 10 * time.Second}
	return server.ListenAndServe()
}
