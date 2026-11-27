-- name: BindAgentSession :one
INSERT INTO agent_sessions (user_id,session_id) VALUES ($1,$2)
ON CONFLICT (session_id) DO UPDATE SET session_id=agent_sessions.session_id
WHERE agent_sessions.user_id=EXCLUDED.user_id
RETURNING session_id;
-- name: CheckAgentSession :one
SELECT session_id FROM agent_sessions WHERE user_id=$1 AND session_id=$2;
