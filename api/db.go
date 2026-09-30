package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	_ "github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

// User metadata and credentials stay off-chain; only the id appears on the ledger.
type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	FullName     string `json:"fullName"`
	Role         string `json:"role"` // official | verifier
	Title        string `json:"title"`
	Organization string `json:"organization"`
	BadgeNo      string `json:"badgeNo,omitempty"`
	passwordHash string
}

type Verification struct {
	ID         string           `json:"id"`
	VerifierID string           `json:"verifierId"`
	Scope      string           `json:"scope"`
	Purpose    string           `json:"purpose"`
	Status     string           `json:"status"` // pending | approved | declined | unauthorized | expired
	OfficialID *string          `json:"officialId,omitempty"`
	Proof      *json.RawMessage `json:"proof,omitempty"`
	CreatedAt  time.Time        `json:"createdAt"`
	DecidedAt  *time.Time       `json:"decidedAt,omitempty"`
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('official','verifier')),
  title         TEXT NOT NULL DEFAULT '',
  organization  TEXT NOT NULL DEFAULT '',
  badge_no      TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS verifications (
  id          TEXT PRIMARY KEY,
  verifier_id UUID NOT NULL REFERENCES users(id),
  scope       TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  official_id UUID REFERENCES users(id),
  proof       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ
);`

// Demo accounts. The chief's id is the genesis ADMIN configured on the chain nodes.
var demoUsers = []User{
	{ID: "00000000-0000-4000-8000-000000000001", Username: "chief", FullName: "Ayesha Perera", Role: "official", Title: "Commissioner", Organization: "National Police HQ", BadgeNo: "NP-0001"},
	{ID: "00000000-0000-4000-8000-000000000002", Username: "director", FullName: "Kamal Jayasuriya", Role: "official", Title: "Director of Operations", Organization: "Customs Directorate", BadgeNo: "CD-0107"},
	{ID: "00000000-0000-4000-8000-000000000003", Username: "silva", FullName: "Nuwan Silva", Role: "official", Title: "Inspector", Organization: "Colombo Central Police", BadgeNo: "NP-2214"},
	{ID: "00000000-0000-4000-8000-000000000004", Username: "fernando", FullName: "Dilini Fernando", Role: "official", Title: "Sergeant", Organization: "Kandy Police", BadgeNo: "NP-3378"},
	{ID: "00000000-0000-4000-8000-000000000005", Username: "bandara", FullName: "Ruwan Bandara", Role: "official", Title: "Customs Officer", Organization: "Port of Colombo", BadgeNo: "CD-4410"},
	{ID: "00000000-0000-4000-8000-000000000006", Username: "citizen", FullName: "Nimal Gunawardena", Role: "verifier", Title: "Citizen", Organization: "Private individual"},
	{ID: "00000000-0000-4000-8000-000000000007", Username: "frontdesk", FullName: "Acme Front Desk", Role: "verifier", Title: "Security Desk", Organization: "Acme Logistics PLC"},
}

const demoPassword = "demo1234"

func openDB(dsn string) *sql.DB {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal(err)
	}
	for i := 0; ; i++ {
		if err = db.Ping(); err == nil {
			break
		}
		if i == 30 {
			log.Fatalf("database unreachable: %v", err)
		}
		time.Sleep(time.Second)
	}
	if _, err := db.Exec(schema); err != nil {
		log.Fatal(err)
	}
	return db
}

func seedUsers(db *sql.DB) {
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM users`).Scan(&n)
	if n > 0 {
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(demoPassword), bcrypt.DefaultCost)
	for _, u := range demoUsers {
		_, err := db.Exec(`INSERT INTO users (id, username, password_hash, full_name, role, title, organization, badge_no)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, u.ID, u.Username, string(hash), u.FullName, u.Role, u.Title, u.Organization, u.BadgeNo)
		if err != nil {
			log.Fatal(err)
		}
	}
	log.Printf("seeded %d demo users (password %q)", len(demoUsers), demoPassword)
}

const userCols = `id, username, password_hash, full_name, role, title, organization, badge_no`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.passwordHash, &u.FullName, &u.Role, &u.Title, &u.Organization, &u.BadgeNo)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func userByUsername(db *sql.DB, username string) (*User, error) {
	return scanUser(db.QueryRow(`SELECT `+userCols+` FROM users WHERE username = $1`, username))
}

func userByID(db *sql.DB, id string) (*User, error) {
	return scanUser(db.QueryRow(`SELECT `+userCols+` FROM users WHERE id = $1`, id))
}

func listUsers(db *sql.DB) ([]User, error) {
	rows, err := db.Query(`SELECT ` + userCols + ` FROM users ORDER BY role, full_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

const verificationCols = `id, verifier_id, scope, purpose, status, official_id, proof, created_at, decided_at`

func scanVerification(row interface{ Scan(...any) error }) (*Verification, error) {
	var v Verification
	var proof []byte
	err := row.Scan(&v.ID, &v.VerifierID, &v.Scope, &v.Purpose, &v.Status, &v.OfficialID, &proof, &v.CreatedAt, &v.DecidedAt)
	if err != nil {
		return nil, err
	}
	if proof != nil {
		raw := json.RawMessage(proof)
		v.Proof = &raw
	}
	if v.Status == "pending" && time.Since(v.CreatedAt) > verificationTTL {
		v.Status = "expired"
	}
	return &v, nil
}

func verificationByID(db *sql.DB, id string) (*Verification, error) {
	return scanVerification(db.QueryRow(`SELECT `+verificationCols+` FROM verifications WHERE id = $1`, id))
}

func listVerifications(db *sql.DB, userID string) ([]Verification, error) {
	rows, err := db.Query(`SELECT `+verificationCols+` FROM verifications
		WHERE verifier_id = $1 OR official_id = $1 ORDER BY created_at DESC LIMIT 20`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Verification{}
	for rows.Next() {
		v, err := scanVerification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}
