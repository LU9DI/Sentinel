---
name: api-auth-test-review
description: Review Sentinel API boundaries, authentication, authorization, tenant isolation, and regression tests without weakening deterministic safety controls.
---

# API, auth, and test review

Use when changing or reviewing Sentinel/Horus APIs, policy boundaries, identity handling, or integration endpoints.

## Non-negotiable invariants
- Predictive signals must never directly authorize incidents or external actions.
- Preserve deterministic, auditable policy decisions and tenant isolation.
- No endpoint may trust client-provided tenant, role, policy result, or authorization status without server-side verification.
- External actions require the existing explicit policy/approval path; do not create implicit side effects.
- Keep secrets, tokens, customer data, and internal diagnostics out of logs and error responses.

## Review sequence
1. Map the request path: route, authentication middleware, authorization/policy checks, service, persistence, and side effects.
2. Identify trust boundaries and test missing/invalid identity, insufficient permissions, cross-tenant access, replay/duplicate requests, and dependency failures where relevant.
3. Check that denial is fail-closed and that audit events record decision metadata without secrets or unnecessary personal data.
4. Add focused regression tests before changing behavior. Preserve existing contracts unless a migration is explicit.
5. Run targeted tests and static checks available in the repository; distinguish executed checks from recommendations.
6. Summarize findings by severity, with file/line evidence and any untested assumptions.

Do not perform production actions or relax controls to make a test pass.
