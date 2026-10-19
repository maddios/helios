#!/usr/bin/env bash
# Read-only export of partnrup scene-analysis samples for the Helios prompt eval.
# Requires PARTNRUP_DB_HOST, PARTNRUP_DB_PORT, PARTNRUP_DB_NAME, PARTNRUP_DB_USER, PARTNRUP_DB_PASSWORD and PARTNRUP_STILLS_BASE_URL in env.
# Usage: scripts/eval/exportPartnrupSamples.sh <outDir> <mediaId>...
set -euo pipefail

out_dir=$1
shift
mkdir -p "$out_dir"

query() {
	docker run --rm --network host -e MYSQL_PWD="$PARTNRUP_DB_PASSWORD" mysql:8.0 \
		mysql -h "$PARTNRUP_DB_HOST" -P "$PARTNRUP_DB_PORT" -u "$PARTNRUP_DB_USER" "$PARTNRUP_DB_NAME" \
		--default-character-set=utf8mb4 --init-command="SET SESSION TRANSACTION READ ONLY" -N -B --raw -e "$1"
}

for id in "$@"; do
	[[ "$id" =~ ^[0-9]+$ ]] || { echo "invalid media id: $id" >&2; exit 1; }
	sample_dir="$out_dir/$id"
	mkdir -p "$sample_dir/stills"
	query "SELECT JSON_OBJECT(
		'mediaId', m.id,
		'languageId', m.language_id,
		'srt', (SELECT t.srt FROM media_transcript t WHERE t.media_id = m.id AND t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 1),
		'timestampAnalysis', c.timestamp_analysis_json,
		'analysis', c.analysis_json,
		'stills', (SELECT JSON_ARRAYAGG(JSON_OBJECT('filename', s.filename, 'timestampSec', s.timestamp))
			FROM (SELECT filename, timestamp FROM media_still WHERE media_id = m.id AND source = 1 ORDER BY timestamp) s)
	) FROM media m JOIN media_content_metadata c ON c.media_id = m.id WHERE m.id = $id" > "$sample_dir/raw.json"
	python3 - "$sample_dir" "$PARTNRUP_STILLS_BASE_URL" <<'PY'
import json, os, sys, urllib.request
sample_dir, base = sys.argv[1], sys.argv[2].rstrip("/")
raw = json.load(open(os.path.join(sample_dir, "raw.json")))
open(os.path.join(sample_dir, "transcript.srt"), "w").write(raw["srt"] or "")
json.dump(raw["timestampAnalysis"], open(os.path.join(sample_dir, "timestamp_analysis.json"), "w"), indent=2)
json.dump(raw["analysis"], open(os.path.join(sample_dir, "analysis.json"), "w"), indent=2)
stills = []
for index, still in enumerate(raw["stills"] or []):
	name = f"{index:04d}.jpg"
	urllib.request.urlretrieve(f"{base}/{still['filename'].lstrip('/')}", os.path.join(sample_dir, "stills", name))
	stills.append({"index": index, "timestampSec": still["timestampSec"], "file": f"stills/{name}"})
duration = max((s["timestampSec"] for s in stills), default=0) + 3
json.dump({"mediaId": raw["mediaId"], "languageId": raw["languageId"], "durationSec": duration, "stills": stills},
	open(os.path.join(sample_dir, "meta.json"), "w"), indent=2)
os.remove(os.path.join(sample_dir, "raw.json"))
print(f"exported {raw['mediaId']}: {len(stills)} stills")
PY
done
