package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
