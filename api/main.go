// Command api is the off-chain gateway: login, user metadata, the QR
// verification flow, and a thin façade over the chain nodes.
package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const verificationTTL = 10 * time.Minute

type Scope struct {
	Code        string `json:"code"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

var scopes = []Scope{
	{"ADMIN", "Grant authorizations", "Issue and revoke authorizations for other officials (super official)"},
	{"VEHICLE_SEARCH", "Vehicle search", "Stop and search a private vehicle"},
	{"PREMISES_ENTRY", "Premises entry", "Enter and inspect private premises"},
	{"ARREST_EXECUTION", "Execute arrest warrant", "Carry out a court-issued arrest warrant"},
	{"DATA_ACCESS", "Personal data access", "Request personal records from an organisation"},
	{"CUSTOMS_INSPECTION", "Customs inspection", "Open and inspect goods and cargo"},
}

func validScope(code string) bool {
	for _, s := range scopes {
		if s.Code == code {
			return true
		}
	}
	return false
}

type Server struct {
	db     *sql.DB
	chain  *ChainClient
	secret []byte
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	s := &Server{
		db:     openDB(env("DATABASE_URL", "postgres://agc:agc@localhost:5432/agc?sslmode=disable")),
		chain:  NewChainClient(env("CHAIN_NODES", "node1=http://localhost:8081,node2=http://localhost:8082")),
		secret: []byte(env("JWT_SECRET", "dev-secret-change-me")),
	}
	seedUsers(s.db)
	if env("SEED_GRANTS", "true") == "true" {
		go s.seedGrants()
	}
	addr := ":" + env("PORT", "8000")
	log.Printf("api listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, s.routes()))
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/openapi.yaml", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, "openapi.yaml") })

	mux.HandleFunc("GET /api/auth/demo-accounts", s.demoAccounts)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("GET /api/auth/me", s.authed("", s.me))

	mux.HandleFunc("GET /api/scopes", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, scopes) })
	mux.HandleFunc("GET /api/users", s.authed("", s.users))

	mux.HandleFunc("GET /api/grants", s.authed("", s.listGrants))
	mux.HandleFunc("POST /api/grants", s.authed("official", s.createGrant))
	mux.HandleFunc("POST /api/grants/{txId}/revoke", s.authed("official", s.revokeGrant))

	mux.HandleFunc("GET /api/verifications", s.authed("", s.myVerifications))
	mux.HandleFunc("POST /api/verifications", s.authed("verifier", s.createVerification))
	mux.HandleFunc("GET /api/verifications/{id}", s.authed("", s.getVerification))
	mux.HandleFunc("POST /api/verifications/{id}/approve", s.authed("official", s.approveVerification))
	mux.HandleFunc("POST /api/verifications/{id}/decline", s.authed("official", s.declineVerification))

	mux.HandleFunc("GET /api/chain/nodes", s.chainNodes)
	mux.HandleFunc("GET /api/chain/nodes/{name}/blocks", s.chainBlocks)
	return logRequests(mux)
}

// --- auth ---------------------------------------------------------------------

func (s *Server) demoAccounts(w http.ResponseWriter, r *http.Request) {
	type acct struct {
		Username string `json:"username"`
		FullName string `json:"fullName"`
		Role     string `json:"role"`
		Title    string `json:"title"`
	}
	out := []acct{}
	for _, u := range demoUsers {
		out = append(out, acct{u.Username, u.FullName, u.Role, u.Title})
	}
	writeJSON(w, 200, map[string]any{"password": demoPassword, "accounts": out})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Username, Password string }
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	u, err := userByUsername(s.db, strings.ToLower(strings.TrimSpace(in.Username)))
	if err != nil || bcrypt.CompareHashAndPassword([]byte(u.passwordHash), []byte(in.Password)) != nil {
		writeErr(w, 401, "invalid username or password")
		return
	}
	token := signToken(s.secret, Claims{Sub: u.ID, Role: u.Role, Exp: time.Now().Add(12 * time.Hour).Unix()})
	writeJSON(w, 200, map[string]any{"token": token, "user": s.profile(u)})
}

// profile adds the on-chain "super official" flag to the off-chain user record.
func (s *Server) profile(u *User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "fullName": u.FullName, "role": u.Role,
		"title": u.Title, "organization": u.Organization, "badgeNo": u.BadgeNo,
		"isSuper": u.Role == "official" && s.chain.IsAdmin(u.ID)}
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u, err := userByID(s.db, claimsFrom(r).Sub)
	if err != nil {
		writeErr(w, 401, "user no longer exists")
		return
	}
	writeJSON(w, 200, s.profile(u))
}

func (s *Server) users(w http.ResponseWriter, r *http.Request) {
	us, err := listUsers(s.db)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, us)
}

// --- grants -------------------------------------------------------------------

func (s *Server) listGrants(w http.ResponseWriter, r *http.Request) {
	q := url.Values{}
	for _, k := range []string{"subject", "grantor", "scope"} {
		if v := r.URL.Query().Get(k); v != "" {
			q.Set(k, v)
		}
	}
	gs, err := s.chain.Grants(q)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, gs)
}

func (s *Server) createGrant(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GranteeID string `json:"granteeId"`
		Scope     string `json:"scope"`
		ExpiresAt int64  `json:"expiresAt"`
		Note      string `json:"note"`
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil || !validScope(in.Scope) {
		writeErr(w, 400, "granteeId and a known scope are required")
		return
	}
	grantee, err := userByID(s.db, in.GranteeID)
	if err != nil || grantee.Role != "official" {
		writeErr(w, 400, "grantee must be an existing official")
		return
	}
	res, err := s.chain.Submit(TxInput{Type: "GRANT", Actor: claimsFrom(r).Sub, Subject: grantee.ID,
		Scope: in.Scope, ExpiresAt: in.ExpiresAt, Note: strings.TrimSpace(in.Note)})
	s.writeSubmit(w, res, err)
}

func (s *Server) revokeGrant(w http.ResponseWriter, r *http.Request) {
	gs, err := s.chain.Grants(url.Values{})
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	for _, g := range gs {
		if g.TxID == r.PathValue("txId") {
			res, err := s.chain.Submit(TxInput{Type: "REVOKE", Actor: claimsFrom(r).Sub, Subject: g.Grantee, Scope: g.Scope, Ref: g.TxID})
			s.writeSubmit(w, res, err)
			return
		}
	}
	writeErr(w, 404, "grant not found")
}

func (s *Server) writeSubmit(w http.ResponseWriter, res SubmitResult, err error) {
	var ce ChainError
	switch {
	case errors.As(err, &ce):
		writeErr(w, 403, ce.Msg)
	case err != nil:
		writeErr(w, 502, err.Error())
	default:
		writeJSON(w, 201, res)
	}
}

// --- QR verification flow ---------------------------------------------------------
//
// 1. A verifier creates a request for a scope and shows it as a QR code.
// 2. An official scans it, sees who is asking, and consents (or declines).
// 3. On consent the chain checks the official's authority and records a VERIFY
//    transaction; the verifier's screen then shows the official and the proof.

func newCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func (s *Server) createVerification(w http.ResponseWriter, r *http.Request) {
	var in struct{ Scope, Purpose string }
	if json.NewDecoder(r.Body).Decode(&in) != nil || !validScope(in.Scope) || in.Scope == "ADMIN" {
		writeErr(w, 400, "a known scope is required")
		return
	}
	id := newCode()
	_, err := s.db.Exec(`INSERT INTO verifications (id, verifier_id, scope, purpose) VALUES ($1,$2,$3,$4)`,
		id, claimsFrom(r).Sub, in.Scope, strings.TrimSpace(in.Purpose))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	s.writeVerification(w, 201, id)
}

func (s *Server) myVerifications(w http.ResponseWriter, r *http.Request) {
	vs, err := listVerifications(s.db, claimsFrom(r).Sub)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, vs)
}

func (s *Server) getVerification(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	v, err := verificationByID(s.db, strings.ToUpper(r.PathValue("id")))
	if err != nil {
		writeErr(w, 404, "verification request not found")
		return
	}
	// Verifiers only see their own requests; any official may open one to respond.
	if c.Role == "verifier" && v.VerifierID != c.Sub {
		writeErr(w, 403, "not your request")
		return
	}
	s.writeVerification(w, 200, v.ID)
}

// writeVerification returns the request with verifier/official profiles expanded.
func (s *Server) writeVerification(w http.ResponseWriter, status int, id string) {
	v, err := verificationByID(s.db, id)
	if err != nil {
		writeErr(w, 404, "verification request not found")
		return
	}
	out := map[string]any{"request": v, "expiresAt": v.CreatedAt.Add(verificationTTL)}
	if u, err := userByID(s.db, v.VerifierID); err == nil {
		out["verifier"] = u
	}
	if v.OfficialID != nil {
		if u, err := userByID(s.db, *v.OfficialID); err == nil {
			out["official"] = u
		}
	}
	writeJSON(w, status, out)
}

func (s *Server) pendingRequest(w http.ResponseWriter, r *http.Request) *Verification {
	v, err := verificationByID(s.db, strings.ToUpper(r.PathValue("id")))
	if err != nil {
		writeErr(w, 404, "verification request not found")
		return nil
	}
	if v.Status != "pending" {
		writeErr(w, 409, "request is already "+v.Status)
		return nil
	}
	return v
}

func (s *Server) decide(v *Verification, status, officialID string, proof any) error {
	raw, _ := json.Marshal(proof)
	_, err := s.db.Exec(`UPDATE verifications SET status=$2, official_id=$3, proof=$4, decided_at=now()
		WHERE id=$1 AND status='pending'`, v.ID, status, officialID, raw)
	return err
}

func (s *Server) approveVerification(w http.ResponseWriter, r *http.Request) {
	v := s.pendingRequest(w, r)
	if v == nil {
		return
	}
	official := claimsFrom(r).Sub
	check, err := s.chain.Verify(official, v.Scope)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	now := time.Now().UTC()
	if !check.Authorized {
		// The verifier learns that this official does NOT hold the authority.
		_ = s.decide(v, "unauthorized", official, map[string]any{"authorized": false, "checkedAt": now})
		s.writeVerification(w, 200, v.ID)
		return
	}
	res, err := s.chain.Submit(TxInput{Type: "VERIFY", Actor: official, Subject: v.VerifierID,
		Scope: v.Scope, Ref: check.Grant.TxID, Note: "request " + v.ID})
	if err != nil {
		s.writeSubmit(w, res, err)
		return
	}
	proof := map[string]any{"authorized": true, "checkedAt": now, "txId": res.Tx["id"],
		"blockIndex": res.Block.Index, "blockHash": res.Block.Hash, "minedBy": res.Block.Miner,
		"grant": check.Grant, "provenance": check.Provenance}
	if err := s.decide(v, "approved", official, proof); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	s.writeVerification(w, 200, v.ID)
}

func (s *Server) declineVerification(w http.ResponseWriter, r *http.Request) {
	v := s.pendingRequest(w, r)
	if v == nil {
		return
	}
	if err := s.decide(v, "declined", claimsFrom(r).Sub, nil); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	s.writeVerification(w, 200, v.ID)
}

// --- explorer -----------------------------------------------------------------

func (s *Server) chainNodes(w http.ResponseWriter, r *http.Request) {
	out := []map[string]any{}
	for _, n := range s.chain.nodes {
		info := map[string]any{}
		if err := s.chain.call(n, http.MethodGet, "/info", nil, &info); err != nil {
			info = map[string]any{"online": false}
		} else {
			info["online"] = true
		}
		info["name"] = n.Name
		out = append(out, info)
	}
	writeJSON(w, 200, out)
}

func (s *Server) chainBlocks(w http.ResponseWriter, r *http.Request) {
	n, ok := s.chain.Node(r.PathValue("name"))
	if !ok {
		writeErr(w, 404, "unknown node")
		return
	}
	var body json.RawMessage
	if err := s.chain.call(n, http.MethodGet, "/chain", nil, &body); err != nil {
		writeErr(w, 502, n.Name+" is unreachable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

// --- demo seed ----------------------------------------------------------------

// seedGrants adds a small delegation tree on a fresh chain so the demo has history.
func (s *Server) seedGrants() {
	for i := 0; i < 60; i++ {
		n, err := s.chain.Length()
		if err == nil {
			if n > 1 {
				return
			}
			seed := []TxInput{
				{Type: "GRANT", Actor: demoUsers[0].ID, Subject: demoUsers[1].ID, Scope: "ADMIN", Note: "Delegated authority for customs operations"},
				{Type: "GRANT", Actor: demoUsers[0].ID, Subject: demoUsers[2].ID, Scope: "VEHICLE_SEARCH", Note: "Colombo highway checkpoints"},
				{Type: "GRANT", Actor: demoUsers[1].ID, Subject: demoUsers[4].ID, Scope: "CUSTOMS_INSPECTION", Note: "Port of Colombo, terminal 3"},
			}
			for _, tx := range seed {
				if _, err := s.chain.Submit(tx); err != nil {
					log.Printf("seed grant failed: %v", err)
				}
				time.Sleep(1200 * time.Millisecond) // let peers receive each block
			}
			log.Printf("seeded %d demo grants on chain", len(seed))
			return
		}
		time.Sleep(time.Second)
	}
}

// --- helpers --------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		h.ServeHTTP(w, r)
		if r.URL.Path != "/api/chain/nodes" && !strings.HasSuffix(r.URL.Path, "/blocks") {
			log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}
