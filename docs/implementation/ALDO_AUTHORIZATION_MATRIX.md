# Aldo authorization matrix

| Action | Authority | Scope |
| --- | --- | --- |
| Local code, tests and documentation | ALLOWED | This worktree only, one Agent Loop |
| Disposable local database/Auth/browser verification | ALLOWED | Only after preflight; no shared profile |
| Production/shared environment/Drive/Pejeng/original files | PROHIBITED | No reads or writes for delivery work |
| Commit, push, PR, merge, deploy, CI setting | PROHIBITED | Requires a new explicit owner instruction |
| Paid provider calls, billing, credentials | PROHIBITED | Owner gate |
