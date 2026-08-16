# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Use **[GitHub Private Vulnerability Reporting](https://github.com/rsocko/ohm/security/advisories/new)**
(the "Report a vulnerability" button under this repository's **Security** tab).
This creates a private draft security advisory visible only to you and the
maintainers, so the issue can be discussed and fixed before any public
disclosure.

If you're unable to use private reporting for some reason, you may instead
open a [private security advisory draft](https://github.com/rsocko/ohm/security/advisories)
directly, or contact the maintainer listed in [CODEOWNERS](CODEOWNERS).

Please include, where possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal example is ideal)
- The affected version/commit
- Any suggested remediation

## Scope

This repository contains the Ohm web application source code (SvelteKit
frontend/backend, build tooling, and public CI). It does **not** contain:

- Live credentials, API keys, or tokens (these are sanitized from the
  repository; runtime configuration is supplied out-of-band via `.env`, which
  is git-ignored)
- The maintainer's private deployment configuration, infrastructure, or
  homelab topology
- Personal data belonging to the maintainer or their household

If your report concerns the maintainer's private deployment rather than an
issue in this repository's source code, please still use private reporting
so it can be triaged appropriately — just note that context in your report.

## Supported versions

This project does not yet have tagged release branches with independent
security support windows. Security fixes are applied to the `main` branch;
please report against the latest commit on `main`.

## Response

There is no guaranteed SLA — this is a personal/open-source project
maintained on a best-effort basis. We aim to acknowledge new reports within
a reasonable timeframe and will credit reporters (unless anonymity is
requested) once a fix ships.
