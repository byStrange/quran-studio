#!/usr/bin/env bash
# Downloads every section page of the Uzbek Ibn Kathir on shomila.islomiy.info
# into raw/, one file per surah. Polite and resumable: a section already on
# disk is skipped, so re-running after an interruption costs only what is left.
#
#   bash scripts/tafsir-uz/fetch.sh
#
# The pages are served as windows-1251, but Uzbek Cyrillic has letters cp1251
# cannot encode (ҳ қ ғ ў), so the site emits those as &#NNNN; entities. We
# store the bytes exactly as served and leave both the transcode and the
# entity decoding to parse.ts, so raw/ stays a faithful copy of the source.
set -euo pipefail
cd "$(dirname "$0")"
BASE="https://shomila.islomiy.info/index.php?act=book&sec=81&b_id=178"
while IFS=$'\t' read -r sid slug title; do
  case "${sid:-}" in ""|"#"*) continue ;; esac
  out="raw/$slug.html"
  if [ -s "$out" ]; then echo "skip  $slug"; continue; fi
  echo "fetch $slug (s_id=$sid)"
  curl -sS -L --compressed --retry 3 --retry-delay 2 "$BASE&s_id=$sid" -o "$out"
  sleep 1
done < sections.tsv
echo "done: $(ls raw | wc -l) files, $(du -sh raw | cut -f1)"
