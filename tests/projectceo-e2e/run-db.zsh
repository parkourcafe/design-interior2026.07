#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h}
cd "${repo_root}"

for image in postgres:16-alpine postgres:17-alpine; do
  PI_DB_IMAGE="${image}" zsh tests/db5/run.zsh
done

print -r -- "KORA_PILOT_DB_OK pg16=true pg17=true production_changed=false"
