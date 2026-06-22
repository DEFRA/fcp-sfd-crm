#!/usr/bin/env bash
set -euo pipefail
source ~/.config/secrets/atlassian.env

CURL_ARGS=(-sS --fail -u "${ATLASSIAN_EMAIL}:${ATLASSIAN_API_TOKEN}")
if [ -n "${NODE_EXTRA_CA_CERTS:-}" ]; then
  CURL_ARGS+=(--cacert "${NODE_EXTRA_CA_CERTS}")
fi

curl "${CURL_ARGS[@]}" \
  -X POST \
  -H "Content-Type: application/json" \
  "${ATLASSIAN_BASE_URL}/rest/api/3/search/jql" \
  -d '{"jql":"reporter = \"Simon Dunn\" ORDER BY created DESC","maxResults":200,"fields":["summary","status","project","reporter"]}' \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for i in d.get('issues', []):
    proj = i['fields']['project']['key']
    reporter = (i['fields'].get('reporter') or {}).get('displayName', '?')
    print(i['key'] + ' [' + proj + '] [' + reporter + '] - ' + i['fields']['summary'])
"
