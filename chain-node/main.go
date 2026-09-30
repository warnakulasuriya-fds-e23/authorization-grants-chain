// Command chain-node runs one replica of the authorization-grants ledger.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, strings.TrimRight(p, "/"))
		}
	}
	return out
}

func main() {
	id := env("NODE_ID", "node1")
	difficulty, _ := strconv.Atoi(env("DIFFICULTY", "3"))
	genesisTime, _ := strconv.ParseInt(env("GENESIS_TIME", "1767225600"), 10, 64) // 2026-01-01
	admins := splitList(env("GENESIS_ADMINS", "00000000-0000-4000-8000-000000000001"))

	n := NewNode(id, Genesis(admins, genesisTime), difficulty, splitList(os.Getenv("PEERS")), env("DATA_FILE", "data/chain.json"))
	go n.SyncLoop(5 * time.Second)

	addr := ":" + env("PORT", "8080")
	log.Printf("%s listening on %s (difficulty %d, peers %v)", id, addr, difficulty, n.peers)
	log.Fatal(http.ListenAndServe(addr, cors(routes(n))))
}

func routes(n *Node) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok", "nodeId": n.id})
	})

	mux.HandleFunc("GET /info", func(w http.ResponseWriter, r *http.Request) {
		chain := n.Snapshot()
		tip := chain[len(chain)-1]
		info := map[string]any{"nodeId": n.id, "height": tip.Index, "length": len(chain),
			"tipHash": tip.Hash, "difficulty": n.difficulty, "genesisHash": chain[0].Hash}
		if r.URL.Query().Get("peers") == "true" {
			info["peers"] = n.PeerStatuses()
		}
		writeJSON(w, 200, info)
	})

	mux.HandleFunc("GET /chain", func(w http.ResponseWriter, r *http.Request) {
		chain := n.Snapshot()
		writeJSON(w, 200, map[string]any{"nodeId": n.id, "length": len(chain), "blocks": chain})
	})

	mux.HandleFunc("GET /blocks/{index}", func(w http.ResponseWriter, r *http.Request) {
		i, err := strconv.Atoi(r.PathValue("index"))
		chain := n.Snapshot()
		if err != nil || i < 0 || i >= len(chain) {
			writeErr(w, 404, "block not found")
			return
		}
		writeJSON(w, 200, chain[i])
	})

	mux.HandleFunc("POST /transactions", func(w http.ResponseWriter, r *http.Request) {
		var tx Tx
		if err := json.NewDecoder(r.Body).Decode(&tx); err != nil {
			writeErr(w, 400, "invalid JSON")
			return
		}
		tx.ID, tx.Timestamp = "", 0 // assigned by the node
		b, err := n.Submit(tx)
		if err != nil {
			writeErr(w, 422, err.Error())
			return
		}
		writeJSON(w, 201, map[string]any{"tx": b.Transactions[0], "block": b})
	})

	// Grants filtered by grantee (subject) and/or grantor.
	mux.HandleFunc("GET /grants", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		subject, grantor, scope := q.Get("subject"), q.Get("grantor"), q.Get("scope")
		n.mu.Lock()
		out := n.state.GrantsWhere(func(g *Grant) bool {
			return (subject == "" || g.Grantee == subject) && (grantor == "" || g.Grantor == grantor) &&
				(scope == "" || g.Scope == scope)
		}, time.Now().Unix())
		n.mu.Unlock()
		writeJSON(w, 200, out)
	})

	// Is `subject` currently authorized for `scope`? Includes the grant's provenance.
	mux.HandleFunc("GET /verify", func(w http.ResponseWriter, r *http.Request) {
		subject, scope := r.URL.Query().Get("subject"), r.URL.Query().Get("scope")
		now := time.Now().Unix()
		n.mu.Lock()
		defer n.mu.Unlock()
		g := n.state.activeGrant(subject, scope, now)
		if g == nil {
			writeJSON(w, 200, map[string]any{"authorized": false})
			return
		}
		writeJSON(w, 200, map[string]any{"authorized": true, "grant": g.withStatus(now),
			"provenance": n.state.Provenance(g, now)})
	})

	// Peer-to-peer block gossip.
	mux.HandleFunc("POST /p2p/blocks", func(w http.ResponseWriter, r *http.Request) {
		var b Block
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeErr(w, 400, "invalid block")
			return
		}
		if err := n.ReceiveBlock(b); err != nil {
			writeErr(w, 409, err.Error())
			return
		}
		writeJSON(w, 202, map[string]string{"status": "accepted"})
	})

	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		h.ServeHTTP(w, r)
	})
}
