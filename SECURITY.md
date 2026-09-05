# Security

## Secrets

- Master key: `BROWSERFLOW_MASTER_KEY_FILE` (AES-256-GCM).
- Session secret: `BROWSERFLOW_SESSION_SECRET_FILE`.
- Never commit `.env`, key files, or decrypted credentials.
- Flow definitions store `CredentialRef` only.

## Auth

Default mode is authenticated. Local unauthenticated mode requires bind `127.0.0.1` and an explicit flag. It is forbidden in production.

## Reporting

Open a private security advisory on the repository. Do not file public issues for secret leaks or RCE.
