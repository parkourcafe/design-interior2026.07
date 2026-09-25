#!/bin/zsh
set -euo pipefail

repo_root=${0:a:h:h:h:h}
profile=archidom-ap1-disposable
docker_host="unix://${HOME}/.colima/${profile}/docker.sock"
output_path=${1:-"/private/tmp/remhaos-wp32-runtime-receipt-$(date +%Y%m%d-%H%M%S).json"}
minimum_free_kib=$((10 * 1024 * 1024))

[[ ${docker_host} == unix://*/.colima/archidom-ap1-disposable/docker.sock ]] || {
  print -u2 -r -- "WP32_FINALIZER_DOCKER_PROFILE_REJECTED"
  exit 65
}
[[ ${output_path} == /private/tmp/* && ! -e ${output_path} && ! -L ${output_path} ]] || {
  print -u2 -r -- "WP32_FINALIZER_OUTPUT_PATH_REJECTED"
  exit 65
}
available_kib=$(df -k "${repo_root}" | awk 'NR==2 {print $4}')
[[ ${available_kib:-0} -ge ${minimum_free_kib} ]] || {
  print -u2 -r -- "WP32_FINALIZER_DISK_RESERVE_REQUIRED"
  exit 65
}
git -C "${repo_root}" diff --quiet || {
  print -u2 -r -- "WP32_FINALIZER_CLEAN_CHECKOUT_REQUIRED"
  exit 65
}

export DOCKER_HOST="${docker_host}"
zsh "${repo_root}/tests/ap1/environment/run-local.zsh" dispose >/dev/null 2>&1 || true
zsh "${repo_root}/tests/ap1/environment/bootstrap-wp32-clamav-bundle.zsh"
cd "${repo_root}"
./node_modules/.bin/tsx tests/pilot-evidence/finalize-wp32-external-runtime-cli.ts "${output_path}"
print -r -- "WP32_FINALIZER_PASS receipt=${output_path}"
