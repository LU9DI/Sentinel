# Sentinel security and repository review

Review date: 2026-10-26
Scope: package manifest, CI workflow, ignore rules, and repository tree. Static review only.

## Verified findings

### Medium priority — CI suppresses npm's install-time audit and has no committed lockfile
`.github/workflows/ci.yml` runs `npm install --no-audit --no-fund`. The repository tree does not contain `package-lock.json`. This makes dependency resolution less reproducible and suppresses the install-time audit. A separate explicit `npm audit --audit-level=high` step is recommended, followed by generating and committing a reviewed lockfile from a trusted Node/npm environment.

### Low priority — ignore rules are incomplete
The existing `.gitignore` excludes `node_modules`, `dist`, and `.env`, but does not cover common coverage, log, local override, or test output files.

## Security invariants to preserve

- Predictive risk signals must not authorize incidents or external actions.
- Keep tenant isolation and authorization enforced server-side.
- Fail closed when identity, policy, or required configuration is missing.
- Keep secrets out of logs, fixtures, and committed files.

## Not claimed

The dependency alert API was not available through the connected repository interface in this review. No claim of zero dependency vulnerabilities or completed penetration testing is made. Tests were not executed as part of this static review.
