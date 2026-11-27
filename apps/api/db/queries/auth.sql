-- name: SessionActive :one
SELECT s.id FROM auth.session s
WHERE s.id=sqlc.arg(session_id)::uuid AND s."userId"=sqlc.arg(user_id)::uuid AND s."expiresAt">now() FOR SHARE OF s;

-- name: Identity :one
SELECT u.id AS user_id,u.name,u.email FROM auth."user" u WHERE u.id=sqlc.arg(user_id)::uuid;
