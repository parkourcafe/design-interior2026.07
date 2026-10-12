import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Подмена команд для проверки управляющей логики backup.sh без базы и
 * контейнера: pg_dumpall / pg_dump / pg_restore пишут и читают файлы той же
 * формы, что настоящие (CREATE ROLE, заголовок PGDMP); tar и gzip — настоящие.
 * Отказ команды включается файлом-флагом в каталоге FAIL.
 * Настоящие pg_dump/pg_restore проверяются отдельно в контейнере postgres.
 */
export function installBackupShims(bin: string, failDir: string): void {
  mkdirSync(bin, { recursive: true });
  mkdirSync(failDir, { recursive: true });
  const shim = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n[ -e "${failDir}/${name}" ] && { echo "${name}: synthetic failure" >&2; exit 1; }\n${body}\n`);
    chmodSync(path, 0o755);
  };
  // pg_dumpall --roles-only --no-role-passwords -f <file>
  shim("pg_dumpall", `out=""; while [ $# -gt 0 ]; do case "$1" in -f) out=$2; shift;; esac; shift; done
printf 'CREATE ROLE synthetic_role;\\n' > "$out"`);
  // pg_dump -Fc -f <file>
  shim("pg_dump", `out=""; while [ $# -gt 0 ]; do case "$1" in -f) out=$2; shift;; esac; shift; done
printf 'PGDMP synthetic custom-format dump body ..........' > "$out"`);
  // pg_restore --list <file> | pg_restore -f /dev/null <file>: читает весь файл, требует PGDMP.
  shim("pg_restore", `f=""; for a in "$@"; do f=$a; done
[ -s "$f" ] || exit 1
[ "$(head -c 5 "$f")" = "PGDMP" ] || { echo "pg_restore: error: did not find magic string in file header" >&2; exit 1; }
[ -e "${failDir}/pg_restore_fullread" ] && case " $* " in *" -f "*) echo "pg_restore: error: could not read from input file: end of file" >&2; exit 1;; esac
exit 0`);
}

/** Синтетический полный набор копии со штампом, как его оставил бы backup.sh. */
export function syntheticSet(dir: string, stamp: string, options: { verified?: boolean; broken?: "dump" | "archive" } = {}): void {
  writeFileSync(join(dir, `roles-${stamp}.sql`), "CREATE ROLE synthetic_role;\n");
  writeFileSync(join(dir, `db-${stamp}.dump`), options.broken === "dump" ? "NOT-A-DUMP" : "PGDMP synthetic dump");
  if (options.broken === "archive") {
    writeFileSync(join(dir, `storage-${stamp}.tar.gz`), "not gzip");
  } else {
    // Настоящий маленький tar.gz: gzip -t и tar -t в backup.sh — настоящие команды.
    // Источник архива — вне каталога копий, иначе остаток .src-<штамп>
    // ложно читался бы как «файл этого набора».
    const src = mkdtempSync(join(tmpdir(), "backup-src-"));
    writeFileSync(join(src, "file.txt"), "SYNTHETIC");
    execFileSync("tar", ["-czf", join(dir, `storage-${stamp}.tar.gz`), "-C", src, "."]);
    rmSync(src, { recursive: true, force: true });
  }
  if (options.verified) writeFileSync(join(dir, `verified-${stamp}.ok`), "");
}

export function hasSet(dir: string, stamp: string): boolean {
  return existsSync(join(dir, `db-${stamp}.dump`)) && existsSync(join(dir, `roles-${stamp}.sql`)) && existsSync(join(dir, `storage-${stamp}.tar.gz`));
}
