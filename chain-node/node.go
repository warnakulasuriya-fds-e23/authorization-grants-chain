package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Node struct {
	mu         sync.Mutex
	id         string
	chain      []Block
	state      *State
	genesis    Block
	difficulty int
	peers      []string
	dataFile   string
	client     *http.Client
}

func NewNode(id string, genesis Block, difficulty int, peers []string, dataFile string) *Node {
	n := &Node{id: id, genesis: genesis, difficulty: difficulty, peers: peers, dataFile: dataFile,
		client: &http.Client{Timeout: 3 * time.Second}}
	n.chain = []Block{genesis}
	n.state, _ = Replay(n.chain, genesis, difficulty)
	n.load()
	return n
}

// load restores a persisted chain if one exists and is still valid.
func (n *Node) load() {
	raw, err := os.ReadFile(n.dataFile)
	if err != nil {
		return
	}
	var chain []Block
	if json.Unmarshal(raw, &chain) != nil {
		return
	}
	if st, err := Replay(chain, n.genesis, n.difficulty); err == nil {
		n.chain, n.state = chain, st
		log.Printf("loaded %d blocks from %s", len(chain), n.dataFile)
	} else {
		log.Printf("ignoring persisted chain: %v", err)
	}
}

func (n *Node) persist() {
	if n.dataFile == "" {
		return
	}
	raw, _ := json.Marshal(n.chain)
	_ = os.MkdirAll(filepath.Dir(n.dataFile), 0o755)
	tmp := n.dataFile + ".tmp"
	if os.WriteFile(tmp, raw, 0o644) == nil {
		_ = os.Rename(tmp, n.dataFile)
	}
}

func (n *Node) Snapshot() []Block {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]Block(nil), n.chain...)
}

func (n *Node) tip() Block { return n.chain[len(n.chain)-1] }

// Submit validates a transaction, mines it into a new block and broadcasts it.
func (n *Node) Submit(tx Tx) (Block, error) {
	n.mu.Lock()
	now := time.Now().Unix()
	if tx.Timestamp == 0 {
		tx.Timestamp = now
	}
	if tx.ID == "" {
		tx.ID = tx.ComputeID()
	}
	prev := n.tip()
	ts := max(now, prev.Timestamp)
	if err := n.state.Validate(tx, prev.Index+1, ts); err != nil {
		n.mu.Unlock()
		return Block{}, err
	}
	b := Block{Index: prev.Index + 1, Timestamp: ts, Transactions: []Tx{tx}, PrevHash: prev.Hash, Miner: n.id}
	b.Mine(n.difficulty)
	_ = n.state.Apply(tx, b.Index, b.Timestamp)
	n.chain = append(n.chain, b)
	n.persist()
	n.mu.Unlock()

	log.Printf("mined block #%d (%s %s)", b.Index, tx.Type, tx.Scope)
	go n.broadcast(b)
	return b, nil
}

func (n *Node) broadcast(b Block) {
	raw, _ := json.Marshal(b)
	for _, p := range n.peers {
		req, _ := http.NewRequest(http.MethodPost, p+"/p2p/blocks", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Peer", n.id)
		if resp, err := n.client.Do(req); err == nil {
			resp.Body.Close()
		}
	}
}

// ReceiveBlock handles a block gossiped by a peer.
func (n *Node) ReceiveBlock(b Block) error {
	n.mu.Lock()
	tip := n.tip()

	switch {
	case b.Index == tip.Index+1 && b.PrevHash == tip.Hash:
		if !b.ValidPoW(n.difficulty) {
			n.mu.Unlock()
			return errors.New("invalid proof of work")
		}
		for _, tx := range b.Transactions {
			if err := n.state.Validate(tx, b.Index, b.Timestamp); err != nil {
				n.mu.Unlock()
				return err
			}
		}
		for _, tx := range b.Transactions {
			_ = n.state.Apply(tx, b.Index, b.Timestamp)
		}
		n.chain = append(n.chain, b)
		n.persist()
		n.mu.Unlock()
		log.Printf("accepted block #%d from %s", b.Index, b.Miner)
		return nil

	case b.Index == tip.Index && b.Hash != tip.Hash && b.PrevHash == tip.PrevHash && b.Hash < tip.Hash:
		// Both nodes mined the same height at once: lowest hash wins deterministically.
		candidate := append(append([]Block(nil), n.chain[:len(n.chain)-1]...), b)
		n.mu.Unlock()
		log.Printf("fork at #%d, adopting peer block (lower hash)", b.Index)
		return n.adopt(candidate)

	case b.Index > tip.Index:
		n.mu.Unlock()
		go n.syncAll()
		return nil
	}
	n.mu.Unlock()
	return nil
}

// adopt replaces the local chain with a longer (or tie-winning) valid chain and
// re-submits any of our transactions that were orphaned by the switch.
func (n *Node) adopt(candidate []Block) error {
	st, err := Replay(candidate, n.genesis, n.difficulty)
	if err != nil {
		return err
	}
	n.mu.Lock()
	var orphans []Tx
	for _, b := range n.chain {
		for _, tx := range b.Transactions {
			if !st.HasTx(tx.ID) {
				orphans = append(orphans, tx)
			}
		}
	}
	n.chain, n.state = candidate, st
	n.persist()
	n.mu.Unlock()

	for _, tx := range orphans {
		if _, err := n.Submit(tx); err != nil {
			log.Printf("dropped orphaned tx %s: %v", tx.ID[:8], err)
		}
	}
	return nil
}

func (n *Node) fetchChain(peer string) ([]Block, error) {
	resp, err := n.client.Get(peer + "/chain")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var body struct {
		Blocks []Block `json:"blocks"`
	}
	err = json.NewDecoder(resp.Body).Decode(&body)
	return body.Blocks, err
}

func (n *Node) syncPeer(peer string) {
	remote, err := n.fetchChain(peer)
	if err != nil {
		return
	}
	n.mu.Lock()
	local := len(n.chain)
	tipHash := n.tip().Hash
	n.mu.Unlock()

	longer := len(remote) > local
	tieWin := len(remote) == local && remote[len(remote)-1].Hash < tipHash
	if longer || tieWin {
		if err := n.adopt(remote); err == nil {
			log.Printf("synced %d blocks from %s", len(remote), peer)
		}
	}
}

func (n *Node) syncAll() {
	for _, p := range n.peers {
		n.syncPeer(p)
	}
}

// SyncLoop periodically reconciles with peers (longest valid chain wins).
func (n *Node) SyncLoop(every time.Duration) {
	for {
		n.syncAll()
		time.Sleep(every)
	}
}

type PeerStatus struct {
	URL       string `json:"url"`
	Reachable bool   `json:"reachable"`
	Height    int    `json:"height"`
	TipHash   string `json:"tipHash,omitempty"`
}

func (n *Node) PeerStatuses() []PeerStatus {
	out := make([]PeerStatus, 0, len(n.peers))
	for _, p := range n.peers {
		ps := PeerStatus{URL: p}
		if resp, err := n.client.Get(p + "/info"); err == nil {
			var info struct {
				Height  int    `json:"height"`
				TipHash string `json:"tipHash"`
			}
			if json.NewDecoder(resp.Body).Decode(&info) == nil {
				ps.Reachable, ps.Height, ps.TipHash = true, info.Height, info.TipHash
			}
			resp.Body.Close()
		}
		out = append(out, ps)
	}
	return out
}
