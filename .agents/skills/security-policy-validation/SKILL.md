---
name: security-policy-validation
description: Validate security policies, detection rules, authorization boundaries, and automated response logic without weakening safeguards.
---

# Security Policy Validation

1. Identify the policy owner, protected asset, trust boundary, and intended allow/deny behavior before changing a rule.
2. Build a test matrix covering allowed cases, denied cases, malformed inputs, missing context, boundary values, and regressions.
3. Default to deny when authorization or required policy context is absent, unless the documented design explicitly requires another safe behavior.
4. Verify ordering and precedence where multiple rules can match. Include conflict and exception cases.
5. Preserve auditability: record rule/version identifiers and reasons for decisions without leaking secrets or sensitive user data.
6. Do not reduce coverage, disable rules, or change severity just to turn a failing test green.
7. Run targeted tests and the complete required validation. Report untested paths and any operational impact.
8. Do not trigger production enforcement, blocklists, incident response, or destructive actions without explicit authorization.
