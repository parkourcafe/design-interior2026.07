# WP-42 authorization matrix

| Action | Target | Authority | Scope | Source/approval quote | Automatic side effects |
|---|---|---|---|---|---|
| Local docs/code/tests | WP-42 branch | ALLOWED | repository-only | “начать реализацию варианта B.” | none |
| Worktree/branch | local repository | ALLOWED | isolated WP-42 | standing launch authorization | none |
| Commit/push/draft PR | non-production WP-42 | ALLOWED | after local gates | standing launch authorization | GitHub CI/ignored preview |
| Migration/RLS/security changes | repository | OWNER_GATE | exact WP-42B packet | standing restriction | DB4/DB5/AP5 CI |
| Shared DB/cloud credentials | any provider | PROHIBITED | none | standing restriction | external state/data |
| Paid cloud/API | any provider | OWNER_GATE | exact maximum spend | standing restriction | billing |
| Merge | WP-42 PR | OWNER_GATE | exact reviewed SHA | migration/security rule | main changes |
| Production/env/DNS/deploy | Vercel/Supabase/cloud | OWNER_GATE | exact rollout | standing restriction | live traffic/data |
