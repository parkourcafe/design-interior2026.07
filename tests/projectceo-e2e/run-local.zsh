#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
cd "${repo_root}"

./node_modules/.bin/vitest run tests/projectceo-e2e/kora-pilot.e2e.test.ts
./node_modules/.bin/tsx tests/projectceo-e2e/run-kora-pilot.ts

print -r -- "KORA_PILOT_LOCAL_OK production_changed=false"
