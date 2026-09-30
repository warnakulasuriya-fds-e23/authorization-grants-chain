package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

type ChainNode struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// ChainClient talks to the ledger nodes. Writes are spread round-robin so both
// replicas mine blocks; any node failing over to the next one.
type ChainClient struct {
	nodes []ChainNode
	next  atomic.Uint32
	http  *http.Client
}

// ChainError is a rule violation reported by a node (e.g. missing ADMIN authority).
type ChainError struct{ Msg string }

func (e ChainError) Error() string { return e.Msg }

func NewChainClient(spec string) *ChainClient {
	c := &ChainClient{http: &http.Client{Timeout: 5 * time.Second}}
	for _, part := range strings.Split(spec, ",") {
		name, u, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok {
			c.nodes = append(c.nodes, ChainNode{Name: name, URL: strings.TrimRight(u, "/")})
		}
	}
	return c
}

func (c *ChainClient) Node(name string) (ChainNode, bool) {
	for _, n := range c.nodes {
		if n.Name == name {
			return n, true
		}
	}
	return ChainNode{}, false
}

// do tries each node in turn, starting from the round-robin cursor.
func (c *ChainClient) do(method, path string, body, out any) (string, error) {
	if len(c.nodes) == 0 {
		return "", errors.New("no chain nodes configured")
	}
	start := int(c.next.Add(1))
	var lastErr error
	for i := range c.nodes {
		n := c.nodes[(start+i)%len(c.nodes)]
		err := c.call(n, method, path, body, out)
		if err == nil {
			return n.Name, nil
		}
		var ce ChainError
		if errors.As(err, &ce) {
			return n.Name, err // a rule violation won't change on another node
		}
		lastErr = err
	}
	return "", fmt.Errorf("all chain nodes unreachable: %w", lastErr)
}

func (c *ChainClient) call(n ChainNode, method, path string, body, out any) error {
	var rd *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, n.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&e)
		if resp.StatusCode < 500 {
			return ChainError{Msg: e.Error}
		}
		return fmt.Errorf("%s: %s", n.Name, e.Error)
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

type TxInput struct {
	Type      string `json:"type"`
	Actor     string `json:"actor"`
	Subject   string `json:"subject"`
	Scope     string `json:"scope"`
	Ref       string `json:"ref,omitempty"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
	Note      string `json:"note,omitempty"`
}

type SubmitResult struct {
	Tx    map[string]any `json:"tx"`
	Block struct {
		Index int    `json:"index"`
		Hash  string `json:"hash"`
		Miner string `json:"miner"`
	} `json:"block"`
}

func (c *ChainClient) Submit(tx TxInput) (SubmitResult, error) {
	var r SubmitResult
	_, err := c.do(http.MethodPost, "/transactions", tx, &r)
	return r, err
}

type Grant struct {
	TxID      string `json:"txId"`
	Grantor   string `json:"grantor"`
	Grantee   string `json:"grantee"`
	Scope     string `json:"scope"`
	Note      string `json:"note,omitempty"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
	GrantedAt int64  `json:"grantedAt"`
	Block     int    `json:"block"`
	Revoked   bool   `json:"revoked"`
	RevokedBy string `json:"revokedBy,omitempty"`
	RevokedAt int64  `json:"revokedAt,omitempty"`
	Status    string `json:"status"`
}

type VerifyResult struct {
	Authorized bool    `json:"authorized"`
	Grant      *Grant  `json:"grant,omitempty"`
	Provenance []Grant `json:"provenance,omitempty"`
}

func (c *ChainClient) Verify(subject, scope string) (VerifyResult, error) {
	var r VerifyResult
	q := url.Values{"subject": {subject}, "scope": {scope}}
	_, err := c.do(http.MethodGet, "/verify?"+q.Encode(), nil, &r)
	return r, err
}

func (c *ChainClient) Grants(q url.Values) ([]Grant, error) {
	out := []Grant{}
	_, err := c.do(http.MethodGet, "/grants?"+q.Encode(), nil, &out)
	return out, err
}

func (c *ChainClient) IsAdmin(uid string) bool {
	r, err := c.Verify(uid, "ADMIN")
	return err == nil && r.Authorized
}

func (c *ChainClient) Length() (int, error) {
	var info struct {
		Length int `json:"length"`
	}
	_, err := c.do(http.MethodGet, "/info", nil, &info)
	return info.Length, err
}
