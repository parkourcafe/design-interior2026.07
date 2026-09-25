#!/bin/zsh
set -euo pipefail

bundle_root=/private/tmp/remhaos-clamav-linux17.rBDwPn
image_id=sha256:0e6f64a14da7f5d8de1a6565e1516f6d023817613bbcdb729b7811c6d984b750
container_name="wp32-bundle-restore-$(uuidgen | tr '[:upper:]' '[:lower:]')"

[[ -z $(docker ps -aq) ]] || { print -u2 -r -- "WP32_BUNDLE_EMPTY_DOCKER_REQUIRED"; exit 65; }
if [[ -e ${bundle_root} ]]; then
  [[ -d ${bundle_root} && ! -L ${bundle_root} ]] || { print -u2 -r -- "WP32_BUNDLE_PATH_REJECTED"; exit 65; }
  [[ -r ${bundle_root}/build/main.cvd && -r ${bundle_root}/build/daily.cvd && -r ${bundle_root}/build/bytecode.cvd && -r ${bundle_root}/build/local-scan.sh ]] || {
    print -u2 -r -- "WP32_BUNDLE_INCOMPLETE"
    exit 65
  }
  print -r -- "WP32_BUNDLE_PRESENT root=${bundle_root}"
  exit 0
fi

docker image inspect "${image_id}" >/dev/null 2>&1 || { print -u2 -r -- "WP32_BUNDLE_IMAGE_MISSING"; exit 66; }
umask 077
mkdir -p "${bundle_root}/build" "${bundle_root}/docker"
cleanup() {
  local exit_status=$?
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
  if (( exit_status != 0 )); then rm -rf -- "${bundle_root}"; fi
  return ${exit_status}
}
trap cleanup EXIT INT TERM
docker create --name "${container_name}" "${image_id}" >/dev/null
for item in main.cvd daily.cvd bytecode.cvd; do
  docker cp "${container_name}:/opt/wp32/cvd/${item}" "${bundle_root}/build/${item}"
done
docker cp "${container_name}:/opt/wp32/local-scan.sh" "${bundle_root}/build/local-scan.sh"
chmod 500 "${bundle_root}/build/local-scan.sh"
[[ -s ${bundle_root}/build/main.cvd && -s ${bundle_root}/build/daily.cvd && -s ${bundle_root}/build/bytecode.cvd ]] || {
  print -u2 -r -- "WP32_BUNDLE_COPY_INCOMPLETE"
  exit 67
}
print -r -- "WP32_BUNDLE_RESTORED root=${bundle_root}"
