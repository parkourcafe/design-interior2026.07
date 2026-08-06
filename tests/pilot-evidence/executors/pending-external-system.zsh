#!/bin/zsh
set -euo pipefail

# Repository-owned honesty boundary: this executable cannot access a real
# external pilot system by itself and therefore never writes a machine receipt.
print -u2 -r -- '{"status":"pending_external_system","receipt":"not_created"}'
exit 75
