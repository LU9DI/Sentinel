# Horus / Sentinel AI — Spec Kit

## Operational invariant
Predictive signal is never an incident and never an authorization. The operational flow is:

Signals → Correlation → Predictive Signal → Risk → Policy → Case / Alert → Outbox.

### v9 Temporal Pattern Engine
Ordered multi-event patterns are deterministic, versioned and explainable. Temporal windows decay after the preferred window and reject candidates outside the maximum window. Confidence is separate from operational risk.

### v10 Entity Graph
Tenant-scoped entity relationships support temporal validity and indirect paths up to three edges. Graph evidence is explicit and auditable.

### v11 Pattern Learning
Learning discovers recurring sequences and volume anomalies only. Candidate promotion requires review and explicit activation. Learning never creates incidents, changes risk or sends alerts.

### v12 Predictive Risk
Algorithm: sentinel-predictive-v12.1. Forecast uses deterministic trend, acceleration, persistence, score, confidence and factors. Predictions feed Risk, then Policy. They do not authorize incidents or external actions.

### Auditability
Critical operational state changes, correlation factors, predictive generation and outbox delivery are persisted/audited.

### Validation
Do not declare check/test/build green without a stable dependency installation and an actual successful execution.