# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through this repository's GitHub Security Advisory
"Report a vulnerability" form. Do not open a public issue for authentication bypass,
cross-character data exposure, claim or token compromise, secret disclosure, remote code
execution, or denial-of-service findings.

Include the affected version or immutable image digest, deployment shape, reproduction,
impact, and any evidence that can be shared safely. Remove bearer tokens, claim secrets,
private memory text, provider prompts, and player messages from logs before attaching them.

## Scope and supported releases

This repository follows the Bunnyland security policy. Findings that affect the Bunnyland
runtime itself, rather than this repository's own code, should be reported against
[bunnyland-server](https://github.com/thalismind/bunnyland-server/security/policy), which
is the canonical policy and the supported-release reference.

The maintainers will acknowledge the report, reproduce it against a supported release,
coordinate a fix and disclosure, and credit the reporter when requested.
