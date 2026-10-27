# Agent guidance

- Treat security policies, detection rules, and response actions as safety-critical controls.
- Preserve fail-closed behavior for missing/invalid policy, malformed input, and authorization uncertainty.
- Every policy change should include positive, negative, boundary, and regression tests where applicable.
- Do not weaken detection thresholds or suppress findings solely to make CI pass; document false-positive/false-negative trade-offs.
- Keep audit records reproducible and avoid logging credentials or sensitive payloads.
- Follow `.agents/skills/verification-gates/SKILL.md` and `.agents/skills/security-policy-validation/SKILL.md`.


## Additional API security skill routing
- Authentication, tenant authorization, API regression tests, or webhook verification: read .agents/skills/api-auth-test-review/SKILL.md.
