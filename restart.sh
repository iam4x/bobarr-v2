#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

bun "$script_dir/scripts/stack.ts" up \
  --detach \
  --build \
  --force-recreate \
  --no-deps \
  bobarr
