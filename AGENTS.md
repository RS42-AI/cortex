# Cortex Repository Instructions

## Git Workflow — Human-Only Production Gate

`main` is the production branch. A change to `main` can publish the Cortex site.

- AI agents may create branches, commit, push non-production branches, create or update pull requests, monitor checks, and report preview results.
- AI agents must never push directly to `main`, force-push or delete `main`, submit an approving review, enable auto-merge, or merge a pull request targeting `main` through GitHub UI, CLI, API, connector, or any other mechanism.
- “Deploy,” “publish,” “ship,” “go live,” approval of the changes, or approval to create a PR never authorize an AI to perform the production merge. The human owner must personally review and merge the PR in GitHub.
- Before any push, run `git branch --show-current`. If it returns `main`, stop and create or switch to a work branch.
- After the PR is open and required checks pass, stop and hand the owner the PR URL, reviewed head commit, check results, preview URL when available, and production consequence of merging.
- If PR creation, review, or merge access is unavailable, stop and report the blocker. Never substitute a direct push or AI-executed merge.
- The absence or failure of GitHub branch protection never relaxes these rules.
- Never change repository visibility, branch protections, rulesets, CODEOWNERS, access permissions, default branches, or production-hosting settings without a separate exact preview and explicit human authorization.
- Never use an owner or administrator credential to bypass the human gate. Automation credentials must be non-owner identities with no production bypass.

If a direct push or AI-executed production merge is discovered, preserve the evidence, disclose it immediately, document it as a workflow incident, and create a remediation task for server-side branch protection and credential separation.
