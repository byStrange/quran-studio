#!/usr/bin/env bash
#
# Release notes, from the commit log.
#
#   scripts/changelog.sh                 what has landed since the last tag
#   scripts/changelog.sh v0.2.0          the range that tag closes
#   scripts/changelog.sh v0.2.0 v0.1.0   an explicit range
#
# Commits are grouped by their conventional-commit prefix where they have one
# and collected under "Other changes" where they do not. This repo has both —
# `feat: scoped quizzes` sits next to `Add a Madani mushaf reader` — so a
# generator that only understood prefixes would silently drop half the history,
# which is the one thing release notes must not do.
#
# Merge commits are skipped: they carry no change of their own, and the commits
# they bring in are already in the range.

set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

to="${1:-HEAD}"
git rev-parse --verify --quiet "$to" >/dev/null || die "no such commit or tag: $to"

# The previous tag is whatever `describe` finds behind $to, excluding $to
# itself so that running this *on* a tag still looks further back.
if [ -n "${2:-}" ]; then
  from="$2"
  git rev-parse --verify --quiet "$from" >/dev/null || die "no such commit or tag: $from"
else
  from="$(git describe --tags --abbrev=0 --match 'v*' "$to^" 2>/dev/null || true)"
fi

if [ -n "$from" ]; then
  range="$from..$to"
else
  # The first release: everything, from the root commit.
  range="$to"
fi

# --- collect ---------------------------------------------------------------

section() {
  local pattern="$1" heading="$2" body
  body="$(git log --no-merges --format='%s|%h' "$range" \
    | grep -E "^($pattern)(\([^)]*\))?!?: " \
    | sed -E 's/^[a-z]+(\([^)]*\))?!?: //' \
    | awk -F'|' '{ printf "- %s (%s)\n", $1, $2 }' || true)"
  [ -n "$body" ] || return 0
  printf '### %s\n\n%s\n\n' "$heading" "$body"
}

# Anything without a prefix this script knows. Kept last and never dropped.
other() {
  local body
  body="$(git log --no-merges --format='%s|%h' "$range" \
    | grep -Ev '^(feat|fix|perf|refactor|docs|test|build|ci|chore|style)(\([^)]*\))?!?: ' \
    | awk -F'|' '{ printf "- %s (%s)\n", $1, $2 }' || true)"
  [ -n "$body" ] || return 0
  printf '### Other changes\n\n%s\n\n' "$body"
}

{
  section 'feat'              'Features'
  section 'fix'               'Fixes'
  section 'perf'              'Performance'
  section 'refactor'          'Refactoring'
  section 'docs'              'Documentation'
  section 'build|ci|chore'    'Build and tooling'
  section 'test'              'Tests'
  other
} > /tmp/changelog.$$ || true

if [ ! -s /tmp/changelog.$$ ]; then
  echo "_No changes recorded in \`$range\`._"
  rm -f /tmp/changelog.$$
  exit 0
fi

cat /tmp/changelog.$$
rm -f /tmp/changelog.$$

# The comparison link is worth more than it costs: it is the one thing in the
# notes that answers "but what actually changed in the code".
if [ -n "$from" ]; then
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  slug="$(printf '%s' "$remote" | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')"
  if [ -n "$slug" ] && printf '%s' "$remote" | grep -q github.com; then
    printf '**Full diff:** https://github.com/%s/compare/%s...%s\n' "$slug" "$from" "$to"
  fi
fi
