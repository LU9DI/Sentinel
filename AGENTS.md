# Repository agent guidance

When changing API boundaries, identity, authorization, tenant isolation, audit events, or related tests, read `.agents/skills/api-auth-test-review/SKILL.md` first.

Preserve deterministic policy enforcement and auditability. Predictive signals never authorize incidents or external actions directly. Test denial paths and tenant boundaries; never weaken controls merely to make tests pass.
