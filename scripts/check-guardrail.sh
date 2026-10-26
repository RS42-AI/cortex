#!/usr/bin/env bash
# Check the publishable working tree without exposing matched private text.
set -euo pipefail
exec python3 "$(dirname "$0")/check-publication.py" "$@"
