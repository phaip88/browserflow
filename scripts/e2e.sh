#!/usr/bin/env bash
# Real-Chromium E2E: runs every credential-free template against the bundled local E2E site.
set -uo pipefail
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3000/e2e-site}"
export BROWSERFLOW_NETWORK_PRIVATE_ALLOWLIST="${BROWSERFLOW_NETWORK_PRIVATE_ALLOWLIST:-127.0.0.1}"
export BROWSERFLOW_LOG_LEVEL=error
started=$(date +%s)
pass=0; fail=0; details="[]"
for t in page-title-url form-fill scheduled-screenshot list-scrape http-plus-page file-output conditional foreach-data; do
  out=$(npx tsx scripts/cli.ts smoke --template "$t" --base-url "$BASE_URL" 2>/dev/null | python3 -c 'import sys,json; t=sys.stdin.read(); i=t.find("{"); d=json.loads(t[i:]) if i>=0 else {"ok":False}; print(json.dumps({"template":sys.argv[1],"ok":d.get("ok",False),"status":d.get("status"),"durationMs":d.get("durationMs"),"artifacts":d.get("artifacts"),"error":d.get("errorMessage")}))' "$t")
  if echo "$out" | grep -q '"ok": true\|"ok":true'; then pass=$((pass+1)); else fail=$((fail+1)); fi
  details=$(python3 -c 'import sys,json; a=json.loads(sys.argv[1]); a.append(json.loads(sys.argv[2])); print(json.dumps(a))' "$details" "$out")
done
python3 -c 'import sys,json; print(json.dumps({"suite":"e2e-chromium-templates","passed":int(sys.argv[1]),"failed":int(sys.argv[2]),"durationSec":int(sys.argv[3]),"results":json.loads(sys.argv[4])}, indent=2))' "$pass" "$fail" "$(( $(date +%s) - started ))" "$details"
[ "$fail" -eq 0 ]
