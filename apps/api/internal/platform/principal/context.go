// Package principal carries the authenticated caller through a request.
package principal

import "context"

// Principal identifies who is acting: the signed-in user, their Better Auth
// session, and whether the call comes from the UI (human), the agent (ai) or an external
// MCP client (mcp, which has no session and carries its OAuth client id).
type Principal struct{ UserID, SessionID, ActorType, ActionID, ClientID string }
type key struct{}

func With(ctx context.Context, p Principal) context.Context { return context.WithValue(ctx, key{}, p) }
func From(ctx context.Context) Principal                    { p, _ := ctx.Value(key{}).(Principal); return p }
