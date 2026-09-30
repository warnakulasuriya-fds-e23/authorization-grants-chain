package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// Minimal HS256 JWTs — enough for a demo without pulling in a JWT library.

type Claims struct {
	Sub  string `json:"sub"`
	Role string `json:"role"`
	Exp  int64  `json:"exp"`
}

var b64 = base64.RawURLEncoding

func signToken(secret []byte, c Claims) string {
	header := b64.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(c)
	unsigned := header + "." + b64.EncodeToString(payload)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(unsigned))
	return unsigned + "." + b64.EncodeToString(mac.Sum(nil))
}

func parseToken(secret []byte, token string) (Claims, error) {
	var c Claims
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return c, errors.New("malformed token")
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	sig, err := b64.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return c, errors.New("invalid signature")
	}
	raw, err := b64.DecodeString(parts[1])
	if err != nil || json.Unmarshal(raw, &c) != nil {
		return c, errors.New("invalid payload")
	}
	if time.Now().Unix() > c.Exp {
		return c, errors.New("token expired")
	}
	return c, nil
}

type ctxKey struct{}

func claimsFrom(r *http.Request) Claims { return r.Context().Value(ctxKey{}).(Claims) }

// authed wraps a handler, requiring a valid bearer token and (optionally) a role.
func (s *Server) authed(role string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			writeErr(w, 401, "missing bearer token")
			return
		}
		c, err := parseToken(s.secret, token)
		if err != nil {
			writeErr(w, 401, err.Error())
			return
		}
		if role != "" && c.Role != role {
			writeErr(w, 403, "only "+role+"s may do this")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, c)))
	}
}
