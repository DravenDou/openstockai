package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestJWTValidation(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{"kid": "test", "kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	}))
	defer srv.Close()
	verifier := NewVerifier(srv.URL, "openstockai", "api")
	for _, tc := range []struct {
		name, issuer, audience string
		expiry                 time.Time
		valid                  bool
	}{
		{"valid", "openstockai", "api", time.Now().Add(time.Minute), true},
		{"expired", "openstockai", "api", time.Now().Add(-time.Minute), false},
		{"wrong issuer", "other", "api", time.Now().Add(time.Minute), false},
		{"wrong audience", "openstockai", "other", time.Now().Add(time.Minute), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, Claims{SID: "session", RegisteredClaims: jwt.RegisteredClaims{Subject: "user", Issuer: tc.issuer, Audience: jwt.ClaimStrings{tc.audience}, ExpiresAt: jwt.NewNumericDate(tc.expiry)}})
			token.Header["kid"] = "test"
			raw, _ := token.SignedString(priv)
			_, err := verifier.Verify(context.Background(), raw)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
	if _, err := verifier.Verify(context.Background(), "not.a.jwt"); err == nil {
		t.Fatal("malformed token accepted")
	}
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, Claims{SID: "session", RegisteredClaims: jwt.RegisteredClaims{Subject: "user", Issuer: "openstockai", Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}})
	token.Header["kid"] = "test"
	raw, _ := token.SignedString(other)
	if _, err := verifier.Verify(context.Background(), raw); err == nil {
		t.Fatal("forged signature accepted")
	}
}

func TestJWTActorClaims(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{"kid": "test", "kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	}))
	defer srv.Close()
	verifier := NewVerifier(srv.URL, "openstockai", "api")
	const user = "0b6f5a50-3c1f-4c5e-9a53-2c6d1f1c0a11"
	for _, tc := range []struct {
		name, sub, sid, act, cid string
		valid                    bool
	}{
		{"session token", user, "session", "", "", true},
		{"session token without sid", user, "", "", "", false},
		{"mcp without sid", user, "", "mcp", "client-1", true},
		{"mcp with sid", user, "session", "mcp", "client-1", false},
		{"mcp without cid", user, "", "mcp", "", false},
		{"mcp with oversized cid", user, "", "mcp", strings.Repeat("c", 513), false},
		{"mcp with non-UUID subject", "user", "", "mcp", "client-1", false},
		{"unknown act", user, "session", "root", "client-1", false},
		{"ai act is not a token actor", user, "session", "ai", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, Claims{SID: tc.sid, Act: tc.act, CID: tc.cid, RegisteredClaims: jwt.RegisteredClaims{Subject: tc.sub, Issuer: "openstockai", Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}})
			token.Header["kid"] = "test"
			raw, _ := token.SignedString(priv)
			claims, err := verifier.Verify(context.Background(), raw)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
			if err == nil && (claims.Act != tc.act || claims.CID != tc.cid) {
				t.Fatalf("claims lost: %+v", claims)
			}
		})
	}
}
