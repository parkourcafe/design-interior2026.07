#!/bin/zsh
# Runs WP-32 DB4/DB5 on the authorized disposable Docker profile only.
set -euo pipefail
repo_root=${0:a:h:h:h:h}
cd "${repo_root}"
export DOCKER_HOST=unix:///Users/msnigmatullaeva/.colima/archidom-ap1-disposable/docker.sock
unset DOCKER_CONTEXT
[[ $# == 0 ]] || { print -u2 'WP32_DB_ARGUMENTS_REJECTED'; exit 64; }
[[ $(docker info --format '{{.ServerVersion}}') != '' ]] || { print -u2 'WP32_DB_DOCKER_UNAVAILABLE'; exit 69; }
available_kib=$(df -Pk . | awk 'NR==2 {print $4}')
(( available_kib >= 5242880 )) || { print -u2 'WP32_DB_DISK_RESERVE_HOLD'; exit 69; }
logs_dir=$(mktemp -d /private/tmp/remhaos-wp32-db.XXXXXX)
print -r -- "WP32_DB_LOGS ${logs_dir}"
run_one() {
  local name=$1 image=$2 script=$3
  print -r -- "WP32_DB_START ${name} ${image}"
  PI_DB_IMAGE="${image}" zsh "${script}" 2>&1 | tee "${logs_dir}/${name}.log"
  print -r -- "WP32_DB_PASS ${name}"
}
run_one db4-pg16 postgres:16-alpine tests/db4/run.zsh
run_one db5-pg16 postgres:16-alpine tests/db5/run.zsh
run_one db4-pg17 postgres:17-alpine tests/db4/run.zsh
run_one db5-pg17 postgres:17-alpine tests/db5/run.zsh
print -r -- "WP32_DB_ALL_PASS logs=${logs_dir}"
