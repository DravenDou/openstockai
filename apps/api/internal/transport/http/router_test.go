package apihttp

import (
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

	"github.com/DravenDou/openstockai/apps/api/internal/app"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/auth"
)

const testUser = "0b6f5a50-3c1f-4c5e-9a53-2c6d1f1c0a11"

func TestDerivePrincipal(t *testing.T) {
	agent, mcp := strings.Repeat("a", 32), strings.Repeat("m", 32)
	header := func(kv ...string) http.Header {
		h := http.Header{}
		for i := 0; i < len(kv); i += 2 {
			h.Set(kv[i], kv[i+1])
		}
		return h
	}
	mcpClaims := &auth.Claims{Act: "mcp", CID: "client-1"}
	mcpClaims.Subject = testUser
	session := &auth.Claims{SID: "0b6f5a50-3c1f-4c5e-9a53-2c6d1f1c0a12"}
	session.Subject = testUser
	for _, tc := range []struct {
		name      string
		claims    *auth.Claims
		header    http.Header
		mcpSecret string
		want      string // actor type, or "" when the call must be rejected
	}{
		{"human", session, header(), mcp, "human"},
		{"human with mcp disabled", session, header(), "", "human"},
		{"agent", session, header("X-Agent-Secret", agent, "X-Agent-Action-ID", "x"), mcp, "ai"},
		{"agent with a wrong secret", session, header("X-Agent-Secret", "nope"), mcp, ""},
		{"mcp", mcpClaims, header("X-MCP-Secret", mcp, "X-Agent-Action-ID", "x"), mcp, "mcp"},
		{"mcp without the secret", mcpClaims, header(), mcp, ""},
		{"mcp with a wrong secret", mcpClaims, header("X-MCP-Secret", strings.Repeat("x", 32)), mcp, ""},
		{"mcp with both secrets", mcpClaims, header("X-MCP-Secret", mcp, "X-Agent-Secret", agent), mcp, ""},
		{"mcp with the agent secret only", mcpClaims, header("X-Agent-Secret", agent), mcp, ""},
		{"mcp disabled", mcpClaims, header("X-MCP-Secret", mcp), "", ""},
		{"mcp disabled with an empty header", mcpClaims, header(), "", ""},
		{"session token with the mcp secret", session, header("X-MCP-Secret", mcp), mcp, ""},
		{"agent with the mcp secret", session, header("X-Agent-Secret", agent, "X-MCP-Secret", mcp), mcp, ""},
		{"non-UUID subject", &auth.Claims{SID: session.SID}, header(), mcp, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, err := derivePrincipal(tc.claims, tc.header, agent, tc.mcpSecret)
			if tc.want == "" {
				if err == nil {
					t.Fatalf("accepted as %+v", p)
				}
				return
			}
			if err != nil || p.ActorType != tc.want {
				t.Fatalf("actor=%q err=%v", p.ActorType, err)
			}
			if tc.want == "mcp" && (p.ClientID != "client-1" || p.SessionID != "" || p.ActionID != "x" || p.UserID != testUser) {
				t.Fatalf("mcp principal: %+v", p)
			}
			if tc.want != "mcp" && p.ClientID != "" {
				t.Fatalf("client id leaked: %+v", p)
			}
		})
	}
}

// The rejections happen before any database access, so the router can run without one.
func TestRouterRejectsInvalidMCPCredentials(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{"kid": "test", "kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	}))
	defer jwks.Close()
	token := func(c auth.Claims) string {
		c.Subject, c.Issuer, c.Audience, c.ExpiresAt = testUser, "openstockai", jwt.ClaimStrings{"api"}, jwt.NewNumericDate(time.Now().Add(time.Hour))
		tk := jwt.NewWithClaims(jwt.SigningMethodEdDSA, c)
		tk.Header["kid"] = "test"
		raw, _ := tk.SignedString(priv)
		return raw
	}
	agent, mcp := strings.Repeat("a", 32), strings.Repeat("m", 32)
	mcpToken := token(auth.Claims{Act: "mcp", CID: "client-1", Scope: "inventory:read inventory:write"})
	for _, tc := range []struct {
		name      string
		token     string
		header    map[string]string
		mcpSecret string
	}{
		{"mcp token without the secret", mcpToken, nil, mcp},
		{"mcp token with a wrong secret", mcpToken, map[string]string{"X-MCP-Secret": strings.Repeat("x", 32)}, mcp},
		{"mcp token with both secrets", mcpToken, map[string]string{"X-MCP-Secret": mcp, "X-Agent-Secret": agent}, mcp},
		{"mcp disabled", mcpToken, map[string]string{"X-MCP-Secret": mcp}, ""},
		{"session token with the mcp secret", token(auth.Claims{SID: testUser}), map[string]string{"X-MCP-Secret": mcp}, mcp},
		{"mcp token without scopes", token(auth.Claims{Act: "mcp", CID: "client-1"}), map[string]string{"X-MCP-Secret": mcp}, mcp},
		{"mcp token with only the write scope", token(auth.Claims{Act: "mcp", CID: "client-1", Scope: "inventory:write"}), map[string]string{"X-MCP-Secret": mcp}, mcp},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(Router(app.New(nil), auth.NewVerifier(jwks.URL, "openstockai", "api"), agent, tc.mcpSecret))
			defer server.Close()
			req, _ := http.NewRequest("GET", server.URL+"/v1/identity", nil)
			req.Header.Set("Authorization", "Bearer "+tc.token)
			for k, v := range tc.header {
				req.Header.Set(k, v)
			}
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 403 {
				t.Fatalf("status %d, want 403", res.StatusCode)
			}
		})
	}
}

func TestMCPScopeAllowed(t *testing.T) {
	for _, tc := range []struct {
		scope, method string
		want          bool
	}{
		{"inventory:read", "GET", true},
		{"inventory:read", "POST", false},
		{"inventory:read inventory:write", "POST", true},
		{"inventory:read inventory:write", "DELETE", true},
		{"inventory:write", "POST", false},
		{"openid inventory:readonly", "GET", false},
		{"", "GET", false},
	} {
		if got := mcpScopeAllowed(tc.scope, tc.method); got != tc.want {
			t.Errorf("mcpScopeAllowed(%q, %s) = %v, want %v", tc.scope, tc.method, got, tc.want)
		}
	}
}
