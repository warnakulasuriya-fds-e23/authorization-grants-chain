package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// Transaction types recorded on the ledger.
const (
	TxGrant  = "GRANT"  // an official with ADMIN grants a scope to another official
	TxRevoke = "REVOKE" // an official with ADMIN revokes an earlier grant
	TxVerify = "VERIFY" // an official consents to disclose an authority to a verifier
)

// GenesisActor is the pseudo-actor that bootstraps the first ADMIN grants.
const GenesisActor = "genesis"

// ScopeAdmin is the authority to grant and revoke other authorities ("super official").
const ScopeAdmin = "ADMIN"

// Tx is a single ledger entry. Only user IDs are stored on chain; names and
// credentials live off-chain in the API's database.
type Tx struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Actor     string `json:"actor"`         // who performed the action
	Subject   string `json:"subject"`       // who the action is about
	Scope     string `json:"scope"`         // authority, e.g. VEHICLE_SEARCH
	Ref       string `json:"ref,omitempty"` // REVOKE/VERIFY: the grant tx id
	ExpiresAt int64  `json:"expiresAt,omitempty"`
	Note      string `json:"note,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// ComputeID derives a deterministic id from the transaction's content.
func (t Tx) ComputeID() string {
	s := fmt.Sprintf("%s|%s|%s|%s|%s|%d|%s|%d", t.Type, t.Actor, t.Subject, t.Scope, t.Ref, t.ExpiresAt, t.Note, t.Timestamp)
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

type Block struct {
	Index        int    `json:"index"`
	Timestamp    int64  `json:"timestamp"`
	Transactions []Tx   `json:"transactions"`
	PrevHash     string `json:"prevHash"`
	Nonce        int    `json:"nonce"`
	Miner        string `json:"miner"`
	Hash         string `json:"hash"`
}

func (b Block) ComputeHash() string {
	txs, _ := json.Marshal(b.Transactions)
	s := fmt.Sprintf("%d|%d|%s|%d|%s|%s", b.Index, b.Timestamp, b.PrevHash, b.Nonce, b.Miner, txs)
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// Mine runs a tiny proof-of-work so blocks are cheap to make but not free to forge.
func (b *Block) Mine(difficulty int) {
	prefix := strings.Repeat("0", difficulty)
	for {
		b.Hash = b.ComputeHash()
		if strings.HasPrefix(b.Hash, prefix) {
			return
		}
		b.Nonce++
	}
}

func (b Block) ValidPoW(difficulty int) bool {
	return b.Hash == b.ComputeHash() && strings.HasPrefix(b.Hash, strings.Repeat("0", difficulty))
}

// Genesis builds the deterministic first block, so every node derives the same one.
func Genesis(admins []string, ts int64) Block {
	txs := make([]Tx, 0, len(admins))
	for _, a := range admins {
		tx := Tx{Type: TxGrant, Actor: GenesisActor, Subject: a, Scope: ScopeAdmin, Note: "Root authority", Timestamp: ts}
		tx.ID = tx.ComputeID()
		txs = append(txs, tx)
	}
	b := Block{Index: 0, Timestamp: ts, Transactions: txs, PrevHash: strings.Repeat("0", 64), Miner: GenesisActor}
	b.Hash = b.ComputeHash()
	return b
}
