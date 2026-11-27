package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	SID string `json:"sid"`
	jwt.RegisteredClaims
}
type Verifier struct {
	URL, Issuer, Audience string
	client                *http.Client
	mu                    sync.Mutex
	keys                  map[string]ed25519.PublicKey
	fetched               time.Time
}

func NewVerifier(url, issuer, audience string) *Verifier {
	return &Verifier{URL: url, Issuer: issuer, Audience: audience, client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("JWKS redirect rejected") }}}
}
func (v *Verifier) key(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if key, ok := v.keys[kid]; ok && time.Since(v.fetched) < 10*time.Minute {
		return key, nil
	}
	if time.Since(v.fetched) < 5*time.Second {
		return nil, errors.New("unknown signing key")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.URL, nil)
	if err != nil {
		return nil, err
	}
	res, err := v.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("JWKS unavailable: %d", res.StatusCode)
	}
	var jwks struct {
		Keys []struct{ KID, KTY, CRV, X, ALG string } `json:"keys"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&jwks); err != nil {
		return nil, err
	}
	if len(jwks.Keys) > 100 {
		return nil, errors.New("invalid JWKS")
	}
	keys := make(map[string]ed25519.PublicKey)
	for _, k := range jwks.Keys {
		if k.KTY != "OKP" || k.CRV != "Ed25519" || (k.ALG != "" && k.ALG != "EdDSA") {
			continue
		}
		b, e := base64.RawURLEncoding.DecodeString(k.X)
		if e == nil && len(b) == ed25519.PublicKeySize && k.KID != "" {
			keys[k.KID] = ed25519.PublicKey(b)
		}
	}
	v.keys = keys
	v.fetched = time.Now()
	if key, ok := keys[kid]; ok {
		return key, nil
	}
	return nil, errors.New("unknown signing key")
}
func (v *Verifier) Verify(ctx context.Context, raw string) (*Claims, error) {
	claims := new(Claims)
	token, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		kid, ok := t.Header["kid"].(string)
		if !ok || kid == "" {
			return nil, errors.New("missing kid")
		}
		return v.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithIssuer(v.Issuer), jwt.WithAudience(v.Audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(10*time.Second))
	if err != nil {
		return nil, fmt.Errorf("invalid or expired token: %w", err)
	}
	if token == nil || !token.Valid {
		return nil, errors.New("invalid or expired token")
	}
	if claims.Subject == "" || claims.SID == "" {
		return nil, errors.New("missing identity or session")
	}
	return claims, nil
}
