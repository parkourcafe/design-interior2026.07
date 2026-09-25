#!/bin/zsh
# Resume the existing disposable stack without resetting its data.
set -euo pipefail
umask 077
repo_root=${0:a:h:h:h:h}
cd "${repo_root}"
export DOCKER_HOST=unix:///Users/msnigmatullaeva/.colima/archidom-ap1-disposable/docker.sock
unset DOCKER_CONTEXT
export SUPABASE_TELEMETRY_DISABLED=1
[[ $# == 0 ]] || { print -u2 'RESUME_ARGUMENTS_REJECTED'; exit 64; }
[[ ! -f supabase/.temp/project-ref ]] || { print -u2 'RESUME_LINKED_PROJECT_REJECTED'; exit 65; }
for tool in docker npm node shasum; do
  command -v "${tool}" >/dev/null || { print -u2 "RESUME_TOOL_MISSING ${tool}"; exit 69; }
done
# Validate the entire ledger before any database mutation.
node -e '
const fs=require("node:fs"), crypto=require("node:crypto");
const lines=fs.readFileSync("tests/ap1/environment/migration-ledger.sha256","utf8").trim().split("\n");
const files=fs.readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")).sort();
const paths=lines.map(line=>{const m=/^([a-f0-9]{64})  (supabase\/migrations\/[0-9]+_[A-Za-z0-9_]+\.sql)$/.exec(line); if(!m)throw Error("LEDGER_FORMAT"); if(crypto.createHash("sha256").update(fs.readFileSync(m[2])).digest("hex")!==m[1])throw Error("LEDGER_DIGEST"); return m[2].split("/").pop();});
if(JSON.stringify(paths)!==JSON.stringify(files))throw Error("LEDGER_FILES");
console.log("RESUME_LEDGER_OK count="+files.length);'
[[ $(docker inspect --format '{{.State.Running}}' supabase_db_archidom-ap1-disposable) == true ]] \
  || { print -u2 'RESUME_DATABASE_NOT_RUNNING'; exit 69; }
docker exec supabase_db_archidom-ap1-disposable pg_isready -U postgres -d postgres
available_kib=$(df -Pk . | awk 'NR==2 {print $4}')
(( available_kib >= 5242880 )) || { print -u2 'RESUME_DISK_RESERVE_HOLD'; exit 69; }
AP1_TEST_PASSWORD=${AP1_TEST_PASSWORD:-}
while (( ${#AP1_TEST_PASSWORD} < 12 )); do
  read -rs 'AP1_TEST_PASSWORD?Временный пароль тестовых пользователей (не менее 12 символов): '
  print
  if (( ${#AP1_TEST_PASSWORD} < 12 )); then
    print -r -- 'Пароль слишком короткий. Введите не менее 12 символов; ввод скрыт.'
  fi
done
export AP1_TEST_PASSWORD
out_dir=$(mktemp -d /private/tmp/remhaos-ap1-resume.XXXXXX)
print -r -- "Журнал: ${out_dir}/result.log"
redact_output() {
  perl -pe '
    s{\bsb(?:p|_secret|_publishable)_[A-Za-z0-9_-]+}{[redacted]}g;
    s{\beyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+}{[redacted]}g;
    s{((?:postgresql?|https?)://)[^:@/\s]+:[^@\s]+@}{$1[redacted]@}gi;
    if (/(?:password|secret|token|authorization|cookie|key)\s*[:=]\s*\S/i) { $_="[credential line redacted]\n"; }
  '
}
run_steps() {
  print -r -- "RESUME_HEAD $(git rev-parse HEAD)"
  npm exec --yes --package=supabase@2.109.1 -- supabase \
    --profile "${repo_root}/tests/ap1/environment/disposable-cli-profile.toml" migration up --local || return $?
  zsh tests/ap1/environment/bootstrap-disposable.zsh --target local || return $?
  print -r -- 'RESUME_BOOTSTRAP_COMPLETE'
}
# pipefail preserves migration/bootstrap errors; no automatic retries or cleanup.
run_steps 2>&1 | redact_output | tee "${out_dir}/result.log"
