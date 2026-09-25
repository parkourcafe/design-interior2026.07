#!/bin/zsh
# Runs the authenticated five-session WP-32 slice against the disposable AP1 stack.
set -euo pipefail
repo_root=${0:a:h:h:h:h}
cd "${repo_root}"
readonly photo_path=/Users/msnigmatullaeva/Downloads/PHOTO-2026-09-11-13-10-09.jpg
export DOCKER_HOST=unix:///Users/msnigmatullaeva/.colima/archidom-ap1-disposable/docker.sock
unset DOCKER_CONTEXT
export SUPABASE_TELEMETRY_DISABLED=1
[[ $# == 0 ]] || { print -u2 'WP32_AP1_ARGUMENTS_REJECTED'; exit 64; }
[[ -r "${photo_path}" ]] || { print -u2 'WP32_AP1_SITE_PHOTO_UNREADABLE'; exit 66; }
[[ -s "${photo_path}" ]] || { print -u2 'WP32_AP1_SITE_PHOTO_EMPTY'; exit 66; }
available_kib=$(df -Pk . | awk 'NR==2 {print $4}')
(( available_kib >= 5242880 )) || { print -u2 'WP32_AP1_DISK_RESERVE_HOLD'; exit 69; }
[[ $(docker inspect --format '{{.State.Running}}' supabase_db_archidom-ap1-disposable) == true ]] \
  || { print -u2 'WP32_AP1_DATABASE_NOT_RUNNING'; exit 69; }
photo_sha=$(shasum -a 256 "${photo_path}" | awk '{print $1}')
print -r -- "WP32_AP1_PHOTO_SHA256 ${photo_sha}"
AP1_KORA_SITE_PHOTO="${photo_path}" \
  zsh tests/ap1/e2e/run-five-sessions.zsh
