# Security

Keep provider credentials, generated owner keys and session secrets outside Git and browser code. The personal installation validates its owner key and issues an origin-bound private session. Never expose a development server publicly or accept client-supplied identity headers as authentication.

Use HTTPS and preserve the private R2 bucket and project ownership checks. Back up control D1, project SQLite snapshots and raw R2 objects. Report suspected vulnerabilities through the repository’s private reporting option when available; never post live secrets or customer data in public issues.
