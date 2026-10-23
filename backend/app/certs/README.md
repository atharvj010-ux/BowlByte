# Database TLS certificates

`prod-ca-2021.crt` is the public Supabase Root CA used for `sslmode=verify-full`
against the session pooler. It is not a secret. The API rewrites
`SUPABASE_DB_URL` / `DATABASE_URL` so `sslrootcert` points here on every host,
including Vercel, instead of a developer machine path.
