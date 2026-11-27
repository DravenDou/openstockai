package apihttp

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/DravenDou/openstockai/apps/api/internal/app"
	"github.com/DravenDou/openstockai/apps/api/internal/platform/auth"
)

type apiTestCall func(method, path, key string, payload any, agent bool, actionID string) (int, map[string]any)

func TestPostgresSecurityAndTransactions(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("pnpm test:integration creates an isolated PostgreSQL database")
	}
	ctx := context.Background()
	pool, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	user, session, otherUser := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,'Test','test@example.com',true,now(),now())`, []any{user}},
		{`INSERT INTO auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,'Other','other@example.com',true,now(),now())`, []any{otherUser}},
		{`INSERT INTO auth.session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1::uuid,$2,$1::text,now()+interval '1 hour',now(),now())`, []any{session, user}},
	} {
		if _, e = pool.Exec(ctx, stmt.sql, stmt.args...); e != nil {
			t.Fatal(e)
		}
	}
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{"kid": "test", "kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	}))
	defer jwks.Close()
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, auth.Claims{SID: session, RegisteredClaims: jwt.RegisteredClaims{Subject: user, Issuer: "openstockai", Audience: jwt.ClaimStrings{"api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}})
	token.Header["kid"] = "test"
	rawToken, _ := token.SignedString(priv)
	secret := strings.Repeat("s", 32)
	runtimeConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	runtimeConfig.MaxConns = 8
	runtimeConfig.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET ROLE openstock_api")
		return err
	}
	runtimePool, err := pgxpool.NewWithConfig(ctx, runtimeConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer runtimePool.Close()
	services := app.New(runtimePool)
	server := httptest.NewServer(Router(services, auth.NewVerifier(jwks.URL, "openstockai", "api"), secret))
	defer server.Close()
	newCaller := func(rawToken string) apiTestCall {
		return func(method, path, key string, payload any, agent bool, actionID string) (int, map[string]any) {
			body, _ := json.Marshal(payload)
			req, _ := http.NewRequest(method, server.URL+"/v1/"+path, bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+rawToken)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", key)
			if agent {
				req.Header.Set("X-Agent-Secret", secret)
				req.Header.Set("X-Agent-Action-ID", actionID)
			}
			res, e := http.DefaultClient.Do(req)
			if e != nil {
				t.Error(e)
				return 0, nil
			}
			defer res.Body.Close()
			var value map[string]any
			_ = json.NewDecoder(res.Body).Decode(&value)
			return res.StatusCode, value
		}
	}
	call := newCaller(rawToken)
	create := func(path string, payload any) string {
		status, result := call("POST", path, uuid.NewString(), payload, false, "")
		if status != 200 {
			t.Fatalf("create %s: %d %v", path, status, result)
		}
		return result["id"].(string)
	}
	warehouse := create("warehouses", map[string]string{"name": "Central"})
	destination := create("warehouses", map[string]string{"name": "North"})
	category := create("categories", map[string]string{"name": "Drinks"})
	product := create("products", map[string]any{"name": "Cola", "sku": "CC-2L", "categoryId": category, "costPrice": "10.10", "salePrice": "14.99", "initialStock": 50, "warehouseId": warehouse})
	missingProduct := uuid.NewString()
	t.Run("database privileges", func(t *testing.T) {
		singleConfig := runtimeConfig.Copy()
		singleConfig.MaxConns = 1
		singlePool, err := pgxpool.NewWithConfig(ctx, singleConfig)
		if err != nil {
			t.Fatal(err)
		}
		defer singlePool.Close()
		tx, err := singlePool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		for _, sql := range []string{
			"SELECT * FROM auth.account",
			`UPDATE auth.session SET token='forbidden'`,
			"DELETE FROM stock_movements",
			"UPDATE stock_movements SET quantity=1",
			"DELETE FROM settings",
			"INSERT INTO settings(id,settings) VALUES(false,'{}')",
			"CREATE TABLE public.unauthorized(id int)",
		} {
			nested, _ := tx.Begin(ctx)
			if _, err = nested.Exec(ctx, sql); err == nil {
				t.Fatalf("unexpected privilege: %s", sql)
			}
			nested.Rollback(ctx)
		}
		tx.Rollback(ctx)
		authTx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer authTx.Rollback(ctx)
		if _, err = authTx.Exec(ctx, "SET LOCAL ROLE openstock_auth"); err != nil {
			t.Fatal(err)
		}
		if _, err = authTx.Exec(ctx, "SELECT * FROM products"); err == nil {
			t.Fatal("authentication role can read inventory")
		}
	})
	t.Run("authentication", func(t *testing.T) {
		anonymous := newCaller("")
		if status, _ := anonymous("GET", "products", "", nil, false, ""); status != 401 {
			t.Fatalf("missing token returned %d", status)
		}
		if status, _ := call("GET", "identity", "", nil, false, ""); status != 200 {
			t.Fatalf("identity returned %d", status)
		}
		if status, _ := call("POST", "products", uuid.NewString(), map[string]any{"name": "invalid", "sku": "X", "costPrice": "0", "salePrice": "0", "organization_id": "x"}, false, ""); status != 400 {
			t.Fatalf("unknown body field accepted: %d", status)
		}
		if status, _ := call("GET", "products", "", nil, true, ""); status != 200 {
			t.Fatalf("agent secret returned %d", status)
		}
		if _, e := pool.Exec(ctx, `UPDATE auth.session SET "expiresAt"=now()-interval '1 minute' WHERE id=$1`, session); e != nil {
			t.Fatal(e)
		}
		status, _ := call("GET", "products", "", nil, false, "")
		_, _ = pool.Exec(ctx, `UPDATE auth.session SET "expiresAt"=now()+interval '1 hour' WHERE id=$1`, session)
		if status != 403 {
			t.Fatalf("expired session returned %d", status)
		}
	})
	t.Run("routes match exact resources and methods", func(t *testing.T) {
		for _, path := range []string{"products/" + product + "/extra", "agent-actions/" + uuid.NewString() + "/approval/extra"} {
			if status, _ := call("GET", path, "", nil, false, ""); status != 404 {
				t.Fatalf("unexpected route %s: %d", path, status)
			}
		}
		if status, _ := call("PUT", "products/"+product, uuid.NewString(), map[string]string{"name": "unsupported"}, false, ""); status != 405 {
			t.Fatalf("unsupported method: %d", status)
		}
	})
	t.Run("agent conversation ownership cannot be reassigned", func(t *testing.T) {
		if _, e := pool.Exec(ctx, `INSERT INTO agent_sessions(user_id,session_id) VALUES($1,'foreign-conversation')`, otherUser); e != nil {
			t.Fatal(e)
		}
		if status, _ := call("POST", "agent-sessions", "", map[string]string{"sessionId": "foreign-conversation"}, true, ""); status != 404 {
			t.Fatalf("foreign conversation rebound: %d", status)
		}
		if status, _ := call("GET", "agent-sessions/foreign-conversation", "", nil, false, ""); status != 404 {
			t.Fatal("foreign conversation readable")
		}
		for i := 0; i < 2; i++ {
			if status, _ := call("POST", "agent-sessions", "", map[string]string{"sessionId": "own-conversation"}, true, ""); status != 200 {
				t.Fatalf("own conversation/retry: %d", status)
			}
		}
	})
	adjust := func(quantity int, warehouseID string) map[string]any {
		kind := "adjustment_in"
		if quantity < 0 {
			kind = "sale"
		}
		return map[string]any{"productId": product, "warehouseId": warehouseID, "quantity": quantity, "type": kind}
	}
	stock := func() int64 {
		var v int64
		if e := pool.QueryRow(ctx, `SELECT sum(quantity)::bigint FROM inventory WHERE product_id=$1`, product).Scan(&v); e != nil {
			t.Fatal(e)
		}
		return v
	}
	count := func(table string) int64 {
		var n int64
		if e := pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %s`, table)).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	t.Run("concurrent adjustments", func(t *testing.T) {
		var wg sync.WaitGroup
		var failed atomic.Int32
		for i := 0; i < 24; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if status, _ := call("POST", "inventory/adjustments", uuid.NewString(), adjust(1, warehouse), false, ""); status != 200 {
					failed.Add(1)
				}
			}()
		}
		wg.Wait()
		if failed.Load() != 0 || stock() != 74 {
			t.Fatalf("failed=%d stock=%d", failed.Load(), stock())
		}
	})
	t.Run("idempotent retries", func(t *testing.T) {
		key := uuid.NewString()
		payload := adjust(2, warehouse)
		before := count("stock_movements")
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if status, _ := call("POST", "inventory/adjustments", key, payload, false, ""); status != 200 {
					t.Errorf("retry %d", status)
				}
			}()
		}
		wg.Wait()
		if stock() != 76 || count("stock_movements") != before+1 {
			t.Fatal("retry duplicated mutation")
		}
		if status, _ := call("POST", "inventory/adjustments", key, adjust(3, warehouse), false, ""); status != 409 {
			t.Fatal("same key accepted different input")
		}
	})
	t.Run("transfer and rollback", func(t *testing.T) {
		payload := map[string]any{"productId": product, "fromWarehouseId": warehouse, "toWarehouseId": destination, "quantity": 10}
		if status, result := call("POST", "inventory/transfers", uuid.NewString(), payload, false, ""); status != 200 {
			t.Fatalf("%d %v", status, result)
		}
		if stock() != 76 {
			t.Fatal("transfer changed total")
		}
		beforeMov, beforeAudit := count("stock_movements"), count("audit_logs")
		payload["toWarehouseId"] = uuid.NewString()
		if status, _ := call("POST", "inventory/transfers", uuid.NewString(), payload, false, ""); status != 422 {
			t.Fatalf("rollback status %d", status)
		}
		if stock() != 76 || count("stock_movements") != beforeMov || count("audit_logs") != beforeAudit {
			t.Fatal("partial transfer committed")
		}
		if status, _ := call("POST", "inventory/adjustments", uuid.NewString(), adjust(-999, warehouse), false, ""); status != 409 {
			t.Fatal("negative stock accepted")
		}
	})
	t.Run("exact money", func(t *testing.T) {
		_, result := call("GET", "products/"+product, "", nil, false, "")
		if result["cost_price"] != "10.10" || result["sale_price"] != "14.99" {
			t.Fatalf("money changed: %v", result)
		}
	})
	t.Run("AI summary and identity reads are explicit audited operations", func(t *testing.T) {
		for _, path := range []string{"inventory/summary", "identity"} {
			action := uuid.NewString()
			status, result := call("POST", "agent-actions", "", map[string]any{"id": action, "conversationId": "summary", "operation": "GET /v1/" + path, "toolInput": map[string]any{}}, true, "")
			if status != 200 || result["approvalStatus"] != "not_required" {
				t.Fatalf("read registration %s: %d %v", path, status, result)
			}
			status, result = call("GET", path, "", nil, true, action)
			if status != 200 {
				t.Fatalf("scoped read %s: %d %v", path, status, result)
			}
			if status, result = call("PATCH", "agent-actions/"+action, "", map[string]any{"status": "completed", "result": result}, true, action); status != 200 {
				t.Fatalf("read audit %s: %d %v", path, status, result)
			}
		}
		if status, _ := call("POST", "agent-actions", "", map[string]any{"id": uuid.NewString(), "conversationId": "summary", "operation": "GET /v1/private", "toolInput": map[string]any{}}, true, ""); status != 422 {
			t.Fatal("unregistered operation accepted")
		}
	})
	t.Run("AI approvals and provenance", func(t *testing.T) {
		action := uuid.NewString()
		payload := adjust(2000, warehouse)
		status, result := call("POST", "agent-actions", "", map[string]any{"id": action, "conversationId": "test", "operation": "POST /v1/inventory/adjustments", "toolInput": payload}, true, "")
		if status != 200 {
			t.Fatalf("%d %v", status, result)
		}
		if status, _ = call("POST", "inventory/adjustments", action, payload, true, action); status != 409 {
			t.Fatal("large AI mutation without approval")
		}
		if status, _ = call("POST", "agent-actions/"+action+"/approval", "", map[string]bool{"approved": true}, false, ""); status != 200 {
			t.Fatal("human approval failed")
		}
		if status, result = call("POST", "agent-actions/"+action+"/execute", "", nil, false, ""); status != 200 {
			t.Fatalf("execute %d %v", status, result)
		}
		if stock() != 2076 {
			t.Fatal("approved mutation missing")
		}
		var actor string
		_ = pool.QueryRow(ctx, `SELECT actor_type FROM stock_movements ORDER BY created_at DESC LIMIT 1`).Scan(&actor)
		if actor != "ai" {
			t.Fatal("AI provenance lost")
		}
	})
	t.Run("atomic purchases and retry", func(t *testing.T) {
		beforeStock, beforeMov := stock(), count("stock_movements")
		key := uuid.NewString()
		payload := map[string]any{"warehouseId": warehouse, "reference": "FAC-001", "items": []any{
			map[string]any{"productId": product, "quantity": 3, "costPrice": "10.10"},
			map[string]any{"product": map[string]any{"name": "Water", "sku": "AGUA", "costPrice": "1.01", "salePrice": "2.99"}, "quantity": 2, "costPrice": "1.01"},
		}}
		for i := 0; i < 2; i++ {
			if status, result := call("POST", "purchases", key, payload, false, ""); status != 200 {
				t.Fatalf("purchase %d %v", status, result)
			}
		}
		if stock() != beforeStock+3 || count("stock_movements") != beforeMov+2 || count("purchase_orders") != 1 {
			t.Fatal("purchase retry duplicated stock or ledger")
		}
		var cost, price string
		if e := pool.QueryRow(ctx, `SELECT cost_price::text,sale_price::text FROM products WHERE sku='AGUA'`).Scan(&cost, &price); e != nil || cost != "1.01" || price != "2.99" {
			t.Fatalf("purchase prices changed: %s %s %v", cost, price, e)
		}
		beforeStock, beforeMov = stock(), count("stock_movements")
		beforeProducts, beforeAudit := count("products"), count("audit_logs")
		payload["reference"] = "FAC-ROLLBACK"
		payload["items"] = []any{
			map[string]any{"product": map[string]any{"name": "Must not persist", "sku": "ROLLBACK", "costPrice": "1", "salePrice": "2"}, "quantity": 2, "costPrice": "1"},
			map[string]any{"productId": missingProduct, "quantity": 1, "costPrice": "1"},
		}
		if status, _ := call("POST", "purchases", uuid.NewString(), payload, false, ""); status != 404 {
			t.Fatalf("foreign purchase returned %d", status)
		}
		if stock() != beforeStock || count("stock_movements") != beforeMov || count("products") != beforeProducts || count("audit_logs") != beforeAudit || count("purchase_orders") != 1 {
			t.Fatal("partial purchase committed")
		}
	})

	t.Run("fractional quantities units filters and atomic categories", func(t *testing.T) {
		saveUnit := map[string]any{"code": "rollo", "name": "Roll", "symbol": "rl", "decimals": 2, "active": true}
		status, result := call("POST", "units", uuid.NewString(), saveUnit, false, "")
		if status != 200 || result["decimals"] != float64(2) {
			t.Fatalf("unit create: %d %v", status, result)
		}
		newProduct := create("products", map[string]any{"name": "Fractional", "sku": "FRACC", "unitCode": "rollo", "minimum": 1.25, "costPrice": "10.10", "salePrice": "14.99", "initialStock": 1.25, "warehouseId": warehouse, "categoryName": "Atomic category", "barcode": "750000001"})
		status, result = call("GET", "products/by-sku?sku=fracc", "", nil, false, "")
		if status != 200 || result["id"] != newProduct || result["stock"] != 1.25 || result["unit_symbol"] != "rl" {
			t.Fatalf("exact SKU/quantity: %d %v", status, result)
		}
		for _, path := range []string{"products?query=750000001&stock=low&limit=1", "products?category=" + result["category_id"].(string) + "&limit=1"} {
			status, page := call("GET", path, "", nil, false, "")
			if status != 200 || page["total"] != float64(1) || len(page["items"].([]any)) != 1 {
				t.Fatalf("filter/count: %d %v", status, page)
			}
		}
		adjustment := map[string]any{"productId": newProduct, "warehouseId": warehouse, "quantity": 0.001, "type": "adjustment_in"}
		if status, _ = call("POST", "inventory/adjustments", uuid.NewString(), adjustment, false, ""); status != 422 {
			t.Fatal("precision ignored", status)
		}
		adjustment["quantity"] = 0.1
		key := uuid.NewString()
		for i := 0; i < 2; i++ {
			if status, result = call("POST", "inventory/adjustments", key, adjustment, false, ""); status != 200 {
				t.Fatal(status, result)
			}
		}
		_, result = call("GET", "products/"+newProduct, "", nil, false, "")
		if result["stock"] != 1.35 {
			t.Fatal("fraction/retry lost precision", result)
		}
		transfer := map[string]any{"productId": newProduct, "fromWarehouseId": warehouse, "toWarehouseId": destination, "quantity": 0.25}
		if status, result = call("POST", "inventory/transfers", uuid.NewString(), transfer, false, ""); status != 200 {
			t.Fatal(status, result)
		}
		_, page := call("GET", "movements-page?product="+newProduct+"&kind=out&limit=1", "", nil, false, "")
		if page["total"] != float64(1) || len(page["items"].([]any)) != 1 {
			t.Fatal("movement pagination failed", page)
		}
		var balance string
		if err := pool.QueryRow(ctx, `SELECT quantity::text FROM inventory WHERE product_id=$1 AND warehouse_id=$2`, newProduct, warehouse).Scan(&balance); err != nil || balance != "1.100" {
			t.Fatal("fraction transfer balance", balance, err)
		}

		saveUnit["decimals"] = 3
		if status, _ = call("POST", "units", uuid.NewString(), saveUnit, false, ""); status != 409 {
			t.Fatal("unit precision changed")
		}
		if status, _ = call("PATCH", "products/"+newProduct, uuid.NewString(), map[string]string{"unitCode": "kg"}, false, ""); status != 409 {
			t.Fatal("history unit changed")
		}
		saveUnit["decimals"] = 2
		saveUnit["active"] = false
		if status, result = call("POST", "units", uuid.NewString(), saveUnit, false, ""); status != 200 {
			t.Fatal(status, result)
		}
		if status, result = call("PATCH", "products/"+newProduct, uuid.NewString(), map[string]string{"name": "Fractional edited"}, false, ""); status != 200 {
			t.Fatal("inactive existing unit prevented edit", status, result)
		}
		beforeCategories, beforeProducts, beforePurchase := count("categories"), count("products"), count("purchase_orders")
		purchase := map[string]any{"warehouseId": warehouse, "reference": "FRACC-ROLLBACK", "items": []any{
			map[string]any{"product": map[string]any{"name": "Do not save", "sku": "ROLLBACK-CATEGORY", "categoryName": "Must not persist", "unitCode": "kg", "costPrice": "1", "salePrice": "2"}, "quantity": 0.125, "costPrice": "1"},
			map[string]any{"productId": missingProduct, "quantity": 0.1, "costPrice": "1"},
		}}
		if status, _ = call("POST", "purchases", uuid.NewString(), purchase, false, ""); status != 404 {
			t.Fatal("foreign purchase accepted", status)
		}
		if count("categories") != beforeCategories || count("products") != beforeProducts || count("purchase_orders") != beforePurchase {
			t.Fatal("category/product/purchase partially committed")
		}
		purchase["items"] = []any{map[string]any{"product": map[string]any{"name": "Fractional purchase", "sku": "PURCHASE-KG", "categoryName": "Purchase category", "unitCode": "kg", "costPrice": "10.10", "salePrice": "14.99"}, "quantity": 0.125, "costPrice": "10.10"}}
		purchase["reference"] = "FRACTIONAL-SUCCESS"
		purchaseKey := uuid.NewString()
		for i := 0; i < 2; i++ {
			if status, result = call("POST", "purchases", purchaseKey, purchase, false, ""); status != 200 {
				t.Fatal("fraction purchase", status, result)
			}
		}
		_, result = call("GET", "products/by-sku?sku=PURCHASE-KG", "", nil, false, "")
		if result["stock"] != 0.125 || result["cost_price"] != "10.10" {
			t.Fatal("fraction purchase changed quantity or money", result)
		}

		if status, _ = call("POST", "products", uuid.NewString(), map[string]any{"name": "Do not save", "sku": "INACTIVE", "unitCode": "rollo", "costPrice": "1", "salePrice": "2"}, false, ""); status != 422 {
			t.Fatal("inactive unit assigned")
		}
	})
	setAutoApprove := func(on bool) {
		if _, e := pool.Exec(ctx, `UPDATE settings SET settings=jsonb_set(settings,'{automatic}',to_jsonb($1::boolean))`, on); e != nil {
			t.Fatal(e)
		}
	}
	t.Run("approval preference is checked at mutation time", func(t *testing.T) {
		action := uuid.NewString()
		payload := adjust(1, warehouse)
		status, result := call("POST", "agent-actions", "", map[string]any{"id": action, "conversationId": "stale", "operation": "POST /v1/inventory/adjustments", "toolInput": payload}, true, "")
		if status != 200 || result["approvalStatus"] != "not_required" {
			t.Fatalf("register action: %d %v", status, result)
		}
		defer setAutoApprove(true)
		setAutoApprove(false)
		beforeStock, beforeMov, beforeAudit := stock(), count("stock_movements"), count("audit_logs")
		status, result = call("POST", "inventory/adjustments", action, payload, true, action)
		if status != 409 || result["error"].(map[string]any)["code"] != "ACTION_STALE" {
			t.Fatalf("stale action accepted: %d %v", status, result)
		}
		if stock() != beforeStock || count("stock_movements") != beforeMov || count("audit_logs") != beforeAudit {
			t.Fatal("stale action changed inventory or audit")
		}
		for _, tc := range []struct {
			operation string
			payload   any
		}{
			{"POST /v1/categories", map[string]string{"name": "Needs approval"}},
			{"POST /v1/suppliers", map[string]string{"name": "Approved supplier", "email": "supplier@example.com"}},
			{"PATCH /v1/products/" + product, map[string]string{"name": "Cola approved"}},
		} {
			action := uuid.NewString()
			status, result := call("POST", "agent-actions", "", map[string]any{"id": action, "conversationId": "approved", "operation": tc.operation, "toolInput": tc.payload}, true, "")
			if status != 200 || result["approvalStatus"] != "pending" {
				t.Fatalf("approval missing for %s: %d %v", tc.operation, status, result)
			}
			if status, result = call("POST", "agent-actions/"+action+"/approval", "", map[string]bool{"approved": true}, false, ""); status != 200 {
				t.Fatalf("approval failed: %d %v", status, result)
			}
			for i := 0; i < 2; i++ {
				if status, result = call("POST", "agent-actions/"+action+"/execute", "", nil, false, ""); status != 200 {
					t.Fatalf("execute/retry %s: %d %v", tc.operation, status, result)
				}
			}
		}
	})
	t.Run("approval preference is enforced by Go", func(t *testing.T) {
		defer setAutoApprove(true)
		setAutoApprove(false)
		action := uuid.NewString()
		payload := adjust(1, warehouse)
		status, result := call("POST", "agent-actions", "", map[string]any{"id": action, "conversationId": "preference", "operation": "POST /v1/inventory/adjustments", "toolInput": payload}, true, "")
		if status != 200 || result["approvalStatus"] != "pending" {
			t.Fatalf("preference ignored: %d %v", status, result)
		}
		if status, _ := call("POST", "inventory/adjustments", action, payload, true, action); status != 409 {
			t.Fatal("small AI mutation bypassed approval preference")
		}
		if status, _ := call("POST", "agent-actions/"+action+"/approval", "", map[string]bool{"approved": false}, false, ""); status != 200 {
			t.Fatal("rejection failed")
		}
		if status, _ := call("POST", "inventory/adjustments", action, payload, true, action); status != 403 {
			t.Fatal("rejected mutation executed")
		}
	})
	t.Run("catalog lifecycle and archived recovery", func(t *testing.T) {
		id := create("categories", map[string]string{"name": "Temporary"})
		if status, _ := call("PATCH", "categories/"+id, uuid.NewString(), map[string]string{"name": "Renamed"}, false, ""); status != 200 {
			t.Fatalf("edit %d", status)
		}
		if status, _ := call("DELETE", "categories/"+category, uuid.NewString(), nil, false, ""); status != 409 {
			t.Fatalf("delete referenced %d", status)
		}
		if status, _ := call("DELETE", "categories/"+id, uuid.NewString(), nil, false, ""); status != 200 {
			t.Fatalf("delete unused %d", status)
		}
		empty := create("products", map[string]string{"name": "Archived", "sku": "ARCHIVED-TEST", "costPrice": "0", "salePrice": "0"})
		if status, _ := call("DELETE", "products/"+empty, uuid.NewString(), nil, false, ""); status != 200 {
			t.Fatalf("archive %d", status)
		}
		status, list := call("GET", "products?status=archived&query=ARCHIVED-TEST", "", nil, false, "")
		if status != 200 || list["total"] != float64(1) {
			t.Fatalf("archived list %d %v", status, list)
		}
		key := uuid.NewString()
		for i := 0; i < 2; i++ {
			if status, _ := call("POST", "products/"+empty+"/restore", key, nil, false, ""); status != 200 {
				t.Fatalf("restore retry %d", status)
			}
		}
		if status, _ := call("GET", "products/"+empty, "", nil, false, ""); status != 200 {
			t.Fatalf("restored read %d", status)
		}
	})
	t.Run("physical counts detect stale and concurrent stock", func(t *testing.T) {
		id := create("products", map[string]any{"name": "Exact count", "sku": "COUNT-TEST", "unitCode": "kg", "costPrice": "0.01", "salePrice": "0.02", "initialStock": 2, "warehouseId": warehouse})
		input := map[string]any{"productId": id, "warehouseId": warehouse, "expected": 2, "counted": 1.125, "reference": "Count"}
		key := uuid.NewString()
		for i := 0; i < 2; i++ {
			status, result := call("POST", "inventory/counts", key, input, false, "")
			if status != 200 || result["difference"] != -.875 {
				t.Fatalf("count retry %d %v", status, result)
			}
		}
		if status, _ := call("POST", "inventory/counts", uuid.NewString(), input, false, ""); status != 409 {
			t.Fatalf("stale count %d", status)
		}
		var successes, conflicts atomic.Int32
		var wg sync.WaitGroup
		for _, count := range []float64{1, .75} {
			wg.Add(1)
			go func(value float64) {
				defer wg.Done()
				status, _ := call("POST", "inventory/counts", uuid.NewString(), map[string]any{"productId": id, "warehouseId": warehouse, "expected": 1.125, "counted": value, "reference": "Concurrent"}, false, "")
				if status == 200 {
					successes.Add(1)
				} else if status == 409 {
					conflicts.Add(1)
				} else {
					t.Errorf("concurrent count %d", status)
				}
			}(count)
		}
		wg.Wait()
		if successes.Load() != 1 || conflicts.Load() != 1 {
			t.Fatalf("count concurrency: %d success / %d conflicts", successes.Load(), conflicts.Load())
		}
		var current float64
		if err := pool.QueryRow(ctx, "SELECT quantity FROM inventory WHERE product_id=$1 AND warehouse_id=$2", id, warehouse).Scan(&current); err != nil {
			t.Fatal(err)
		}
		if status, result := call("POST", "inventory/counts", uuid.NewString(), map[string]any{"productId": id, "warehouseId": warehouse, "expected": current, "counted": 0, "reference": "Empty by count"}, false, ""); status != 200 || result["counted"] != float64(0) {
			t.Fatalf("zero count %d %v", status, result)
		}
	})
	t.Run("history cursors and privileges", func(t *testing.T) {
		firstStatus, first := call("GET", "audit-page?limit=1", "", nil, false, "")
		if firstStatus != 200 || first["next"] == nil {
			t.Fatalf("audit page %d %v", firstStatus, first)
		}
		cursor := first["next"].(map[string]any)
		path := "audit-page?limit=1&beforeId=" + cursor["id"].(string) + "&beforeDate=" + url.QueryEscape(cursor["date"].(string))
		if status, next := call("GET", path, "", nil, false, ""); status != 200 || next["items"].([]any)[0].(map[string]any)["id"] == first["items"].([]any)[0].(map[string]any)["id"] {
			t.Fatalf("cursor %d %v", status, next)
		}
		if status, _ := call("GET", "audit-page?beforeId=bad&beforeDate=bad", "", nil, false, ""); status != 400 {
			t.Fatalf("invalid cursor %d", status)
		}
		if status, result := call("GET", "purchases-page?limit=1", "", nil, false, ""); status != 200 || len(result["items"].([]any)) == 0 {
			t.Fatalf("purchases %d %v", status, result)
		}
		for _, route := range []string{"audit-page", "audit-logs"} {
			if status, _ := call("GET", route, "", nil, false, ""); status != 200 {
				t.Fatalf("audit %s returned %d", route, status)
			}
		}
	})
	t.Run("destructive operations always need approval even with auto-approve on", func(t *testing.T) {
		setAutoApprove(true)
		victim := create("products", map[string]string{"name": "Doomed", "sku": "DOOMED", "costPrice": "0", "salePrice": "0"})
		spare := create("categories", map[string]string{"name": "Spare category"})
		for _, tc := range []struct{ operation, key string }{
			{"DELETE /v1/products/" + victim, "products/" + victim},
			{"DELETE /v1/categories/" + spare, "categories/" + spare},
		} {
			action := uuid.NewString()
			status, result := call("POST", "agent-actions", "", map[string]any{"id": action, "conversationId": "destructive", "operation": tc.operation, "toolInput": map[string]any{}}, true, "")
			if status != 200 || result["approvalStatus"] != "pending" {
				t.Fatalf("%s skipped approval: %d %v", tc.operation, status, result)
			}
			if status, _ = call("DELETE", tc.key, action, map[string]any{}, true, action); status != 409 {
				t.Fatalf("%s ran without approval: %d", tc.operation, status)
			}
			if status, result = call("POST", "agent-actions/"+action+"/approval", "", map[string]bool{"approved": true}, false, ""); status != 200 {
				t.Fatalf("approval failed: %d %v", status, result)
			}
			if status, result = call("POST", "agent-actions/"+action+"/execute", "", nil, false, ""); status != 200 {
				t.Fatalf("execute %s: %d %v", tc.operation, status, result)
			}
		}
		restore := uuid.NewString()
		status, result := call("POST", "agent-actions", "", map[string]any{"id": restore, "conversationId": "destructive", "operation": "POST /v1/products/" + victim + "/restore", "toolInput": map[string]any{}}, true, "")
		if status != 200 || result["approvalStatus"] != "pending" {
			t.Fatalf("restore skipped approval: %d %v", status, result)
		}
		if status, _ = call("POST", "agent-actions/"+restore+"/approval", "", map[string]bool{"approved": false}, false, ""); status != 200 {
			t.Fatal("rejection failed")
		}
		if status, _ = call("POST", "agent-actions/"+restore+"/execute", "", nil, false, ""); status != 409 {
			t.Fatalf("rejected restore executed: %d", status)
		}
		low := uuid.NewString()
		status, result = call("POST", "agent-actions", "", map[string]any{"id": low, "conversationId": "destructive", "operation": "POST /v1/categories", "toolInput": map[string]string{"name": "Low risk"}}, true, "")
		if status != 200 || result["approvalStatus"] != "not_required" {
			t.Fatalf("low-risk create should auto-approve: %d %v", status, result)
		}
	})
	t.Run("immutable ledger", func(t *testing.T) {
		if _, e := pool.Exec(ctx, `DELETE FROM stock_movements`); e == nil {
			t.Fatal("ledger can be deleted")
		}
	})
}
