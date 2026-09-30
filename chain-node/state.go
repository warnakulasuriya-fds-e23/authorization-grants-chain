package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// Grant is the derived view of a GRANT transaction and its current status.
type Grant struct {
	TxID         string `json:"txId"`
	Grantor      string `json:"grantor"`
	Grantee      string `json:"grantee"`
	Scope        string `json:"scope"`
	Note         string `json:"note,omitempty"`
	ExpiresAt    int64  `json:"expiresAt,omitempty"`
	GrantedAt    int64  `json:"grantedAt"`
	Block        int    `json:"block"`
	Revoked      bool   `json:"revoked"`
	RevokedBy    string `json:"revokedBy,omitempty"`
	RevokedAt    int64  `json:"revokedAt,omitempty"`
	RevokedBlock int    `json:"revokedBlock,omitempty"`
	Status       string `json:"status"` // filled in on read: active | revoked | expired
}

func (g *Grant) ActiveAt(ts int64) bool {
	return !g.Revoked && (g.ExpiresAt == 0 || ts < g.ExpiresAt)
}

func (g Grant) withStatus(now int64) Grant {
	switch {
	case g.Revoked:
		g.Status = "revoked"
	case g.ExpiresAt != 0 && now >= g.ExpiresAt:
		g.Status = "expired"
	default:
		g.Status = "active"
	}
	return g
}

// State is the world state obtained by replaying every block from genesis.
type State struct {
	grants map[string]*Grant // by tx id
	order  []string          // grant tx ids in chain order
	seen   map[string]bool   // every tx id already on chain
}

func NewState() *State { return &State{grants: map[string]*Grant{}, seen: map[string]bool{}} }

func (s *State) HasTx(id string) bool { return s.seen[id] }

func (s *State) activeGrant(subject, scope string, ts int64) *Grant {
	for i := len(s.order) - 1; i >= 0; i-- {
		g := s.grants[s.order[i]]
		if g.Grantee == subject && g.Scope == scope && g.ActiveAt(ts) {
			return g
		}
	}
	return nil
}

// Validate checks a transaction against the rules without mutating state.
func (s *State) Validate(tx Tx, blockIndex int, ts int64) error {
	if tx.ID != tx.ComputeID() {
		return errors.New("transaction id does not match its content")
	}
	if s.seen[tx.ID] {
		return errors.New("transaction already on chain")
	}
	if tx.Actor == "" || tx.Subject == "" {
		return errors.New("actor and subject are required")
	}
	scope := strings.TrimSpace(tx.Scope)
	if scope == "" {
		return errors.New("scope is required")
	}
	if tx.Actor == GenesisActor {
		if blockIndex != 0 {
			return errors.New("genesis actor is only valid in block 0")
		}
		return nil
	}

	switch tx.Type {
	case TxGrant:
		if s.activeGrant(tx.Actor, ScopeAdmin, ts) == nil {
			return fmt.Errorf("actor %s does not hold ADMIN authority", tx.Actor)
		}
		if tx.Actor == tx.Subject {
			return errors.New("officials cannot grant authority to themselves")
		}
		if tx.ExpiresAt != 0 && tx.ExpiresAt <= ts {
			return errors.New("expiry must be in the future")
		}
		if s.activeGrant(tx.Subject, scope, ts) != nil {
			return fmt.Errorf("subject already holds an active %s grant", scope)
		}
	case TxRevoke:
		if s.activeGrant(tx.Actor, ScopeAdmin, ts) == nil {
			return fmt.Errorf("actor %s does not hold ADMIN authority", tx.Actor)
		}
		g, ok := s.grants[tx.Ref]
		if !ok {
			return errors.New("referenced grant does not exist")
		}
		if g.Revoked {
			return errors.New("grant is already revoked")
		}
		if g.Grantee != tx.Subject || g.Scope != scope {
			return errors.New("subject/scope do not match the referenced grant")
		}
	case TxVerify:
		g := s.activeGrant(tx.Actor, scope, ts)
		if g == nil {
			return fmt.Errorf("official does not hold an active %s authority", scope)
		}
		if tx.Ref != g.TxID {
			return errors.New("ref must point to the official's active grant")
		}
	default:
		return fmt.Errorf("unknown transaction type %q", tx.Type)
	}
	return nil
}

// Apply validates and then records a transaction.
func (s *State) Apply(tx Tx, blockIndex int, ts int64) error {
	if err := s.Validate(tx, blockIndex, ts); err != nil {
		return err
	}
	s.seen[tx.ID] = true
	switch tx.Type {
	case TxGrant:
		s.grants[tx.ID] = &Grant{TxID: tx.ID, Grantor: tx.Actor, Grantee: tx.Subject, Scope: tx.Scope,
			Note: tx.Note, ExpiresAt: tx.ExpiresAt, GrantedAt: tx.Timestamp, Block: blockIndex}
		s.order = append(s.order, tx.ID)
	case TxRevoke:
		g := s.grants[tx.Ref]
		g.Revoked, g.RevokedBy, g.RevokedAt, g.RevokedBlock = true, tx.Actor, tx.Timestamp, blockIndex
	}
	return nil
}

// Replay rebuilds state from a full chain, verifying links, proof-of-work and rules.
func Replay(chain []Block, genesis Block, difficulty int) (*State, error) {
	if len(chain) == 0 || chain[0].Hash != genesis.Hash {
		return nil, errors.New("genesis block mismatch")
	}
	s := NewState()
	for i, b := range chain {
		if i > 0 {
			prev := chain[i-1]
			if b.Index != i || b.PrevHash != prev.Hash || !b.ValidPoW(difficulty) || b.Timestamp < prev.Timestamp {
				return nil, fmt.Errorf("invalid block %d", i)
			}
		}
		for _, tx := range b.Transactions {
			if err := s.Apply(tx, b.Index, b.Timestamp); err != nil {
				return nil, fmt.Errorf("block %d: %w", i, err)
			}
		}
	}
	return s, nil
}

// Query helpers ---------------------------------------------------------------

func (s *State) GrantsWhere(match func(*Grant) bool, now int64) []Grant {
	out := []Grant{}
	for _, id := range s.order {
		if g := s.grants[id]; match(g) {
			out = append(out, g.withStatus(now))
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Block > out[j].Block })
	return out
}

// Provenance walks from a grant up through each grantor's ADMIN grant to genesis.
func (s *State) Provenance(g *Grant, now int64) []Grant {
	out := []Grant{g.withStatus(now)}
	seen := map[string]bool{g.TxID: true}
	cur := g
	for cur.Grantor != GenesisActor {
		// the ADMIN grant the grantor held when this grant was issued
		var parent *Grant
		for i := len(s.order) - 1; i >= 0; i-- {
			p := s.grants[s.order[i]]
			if p.Grantee == cur.Grantor && p.Scope == ScopeAdmin && p.Block <= cur.Block {
				parent = p
				break
			}
		}
		if parent == nil || seen[parent.TxID] {
			break
		}
		seen[parent.TxID] = true
		out = append(out, parent.withStatus(now))
		cur = parent
	}
	return out
}
