#!/usr/bin/env python3
"""Check a publishable source tree; report only paths and finding categories.

Optionally set CORTEX_PRIVATE_DENYLIST to a UTF-8 file outside this tree. Each
nonempty, non-comment line is a case-insensitive literal to keep private. The
list and matched text are never printed. This is a working-tree check, not a
Git-history audit or proof that every possible secret has been detected.
"""

import argparse
import json
import os
from pathlib import Path
import re
import sys


EXCLUDED_DIRECTORIES = {
    ".git",
    "node_modules",
    "public",
    ".quartz-cache",
    ".wrangler",
    "coverage",
    ".verify-scratch",
    "__pycache__",
}
PRIVATE_DIRECTORIES = {".private", ".aws", ".ssh", ".gnupg"}

PATTERNS = {
    "private-key": re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"
    ),
    "github-token": re.compile(
        r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b"
    ),
    "openai-token": re.compile(
        r"\bsk-(?:(?:proj-|svcacct-)[A-Za-z0-9_-]{32,}|[A-Za-z0-9]{48})\b"
    ),
    "anthropic-token": re.compile(r"\bsk-ant-[A-Za-z0-9_-]{32,}\b"),
    "aws-access-key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "slack-token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "google-api-key": re.compile(r"\bAIza[A-Za-z0-9_-]{35}\b"),
    "stripe-live-key": re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b"),
    "personal-absolute-path": re.compile(
        r"/(?:Users|home)/[^/\s\"'<>]+/"
        r"|\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]"
        r"[^\\/\s\"'<>]+[\\/]"
    ),
}


def is_inside(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def local_config_file(name):
    lower = name.lower()
    if lower.endswith((".example", ".sample", ".template")):
        return False
    if lower == ".env" or lower.startswith(".env."):
        return True
    if lower == ".dev.vars" or lower.startswith(".dev.vars."):
        return True
    if lower in {
        ".netrc", ".git-credentials", ".npmrc", ".pypirc",
        ".envrc", ".publication-denylist",
        "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    }:
        return True
    return (
        lower.endswith((".pem", ".key", ".local.json", ".local.jsonc", ".local.toml"))
        or bool(re.fullmatch(r"(?:credentials|service-account)[^/]*\.json", lower))
    )


def internal_process_path(path):
    parts = path.parts
    return any(
        parts[index:index + 2] == ("docs", "superpowers")
        for index in range(len(parts) - 1)
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=str(Path(__file__).resolve().parent.parent))
    args = parser.parse_args()
    try:
        root = Path(args.root).resolve(strict=True)
        if not root.is_dir():
            raise OSError
    except (OSError, ValueError, RuntimeError):
        print("PUBLICATION ERROR: unreadable-source-root", file=sys.stderr)
        return 2

    denylist = []
    private_list = os.environ.get("CORTEX_PRIVATE_DENYLIST")
    if private_list:
        try:
            provided = Path(os.path.abspath(os.path.expanduser(private_list)))
            resolved = provided.resolve(strict=True)
            if is_inside(provided, root) or is_inside(resolved, root):
                raise ValueError
            denylist = [
                line.strip().casefold()
                for line in resolved.read_text(encoding="utf-8").splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            ]
        except (OSError, UnicodeError, ValueError, RuntimeError):
            print("PUBLICATION ERROR: private-denylist-must-be-readable-and-outside-source-tree", file=sys.stderr)
            return 2

    findings = set()
    scanned_files = 0

    def report(path, category):
        findings.add((path.relative_to(root).as_posix(), category))

    def walk(directory):
        nonlocal scanned_files
        try:
            entries = sorted(os.scandir(directory), key=lambda entry: entry.name)
        except OSError:
            report(directory, "unreadable-path")
            return
        for entry in entries:
            path = Path(entry.path)
            try:
                symlink = entry.is_symlink()
                directory_entry = entry.is_dir(follow_symlinks=False)
                if entry.name in EXCLUDED_DIRECTORIES and (
                    directory_entry or symlink or entry.name == ".git"
                ):
                    continue
                if symlink:
                    report(path, "source-symlink")
                    continue
                if internal_process_path(path.relative_to(root)):
                    report(path, "internal-process-material")
                    continue
                if directory_entry:
                    if entry.name in PRIVATE_DIRECTORIES:
                        report(path, "private-local-material")
                        continue
                    walk(path)
                    continue
                if not entry.is_file(follow_symlinks=False):
                    report(path, "nonregular-source-file")
                    continue
                if local_config_file(entry.name):
                    report(path, "local-secret-or-config-file")
                text = path.read_bytes().decode("utf-8", errors="replace")
                scanned_files += 1
                for category, pattern in PATTERNS.items():
                    if pattern.search(text):
                        report(path, category)
                if denylist and any(term in text.casefold() for term in denylist):
                    report(path, "private-denylist-match")
            except OSError:
                report(path, "unreadable-path")

    walk(root)
    for path, category in sorted(findings):
        print(f"PUBLICATION FAIL: {category}: {json.dumps(path)}", file=sys.stderr)
    if findings:
        print(f"PUBLICATION FAIL: {len(findings)} findings; matched text withheld.", file=sys.stderr)
        return 1
    print(f"PUBLICATION PASS: checked {scanned_files} source files; no configured findings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
