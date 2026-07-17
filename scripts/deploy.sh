#!/usr/bin/env bash
# deploy.sh — deploy SDF engine เข้าหลาย NetSuite account ด้วยคำสั่งเดียว + stamp version (#11)
#
# suitecloud project:deploy ไม่มี flag --authid — มันอ่าน defaultAuthId จาก engine/project.json
# เท่านั้น. multi-account จึงทำโดย loop: เขียน defaultAuthId ใหม่ต่อ account → deploy → คืนค่าเดิม.
# ก่อน loop จะ stamp engine/VERSION + git sha + UTC ลงไฟล์ใน File Cabinet เพื่อให้ตรวจ version
# ที่ deploy ไปได้จากตัว account เอง (?action=version หรือเปิดไฟล์ใน File Cabinet).
#
# ใช้:
#   scripts/deploy.sh                    # deploy ทุก authid ใน engine/deploy-targets.txt
#   scripts/deploy.sh --dryrun           # preview อย่างเดียว ไม่ deploy จริง
#   scripts/deploy.sh teibto-sb2 acc2    # deploy เฉพาะ authid ที่ระบุ (แทน targets file)
#   scripts/deploy.sh --dryrun teibto-sb2 teibto-sb2
#
# @author Wichit Wongta @since 2026-07-17
set -euo pipefail

# --- paths -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENGINE_DIR="${REPO_ROOT}/engine"
PROJECT_JSON="${ENGINE_DIR}/project.json"
VERSION_FILE="${ENGINE_DIR}/VERSION"
TARGETS_FILE="${ENGINE_DIR}/deploy-targets.txt"
APP_DIR="${ENGINE_DIR}/src/FileCabinet/SuiteScripts/pdf-layout-designer"
STAMP_FILE="${APP_DIR}/pld_version.txt"

# --- 0) parse args -----------------------------------------------------------
DRYRUN=0
AUTHIDS=()
for arg in "$@"; do
  case "$arg" in
    --dryrun) DRYRUN=1 ;;
    -*) echo "ERROR: unknown option '$arg'" >&2; exit 2 ;;
    *) AUTHIDS+=("$arg") ;;
  esac
done

# authid list: จาก args ถ้ามี ไม่งั้นอ่านจาก targets file (ข้ามบรรทัดว่าง/comment)
if [ "${#AUTHIDS[@]}" -eq 0 ]; then
  if [ ! -f "${TARGETS_FILE}" ]; then
    echo "ERROR: ไม่มี ${TARGETS_FILE} และไม่ได้ระบุ authid ทาง args" >&2
    echo "       สร้างจาก template: cp engine/deploy-targets.txt.example engine/deploy-targets.txt" >&2
    echo "       (ไฟล์นี้ gitignore ไว้ — authid ลูกค้าเป็นข้อมูลอ่อนไหว ห้าม commit)" >&2
    exit 1
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"                       # ตัด comment
    line="$(echo "$line" | tr -d '[:space:]')" # ตัด whitespace
    [ -n "$line" ] && AUTHIDS+=("$line")
  done < "${TARGETS_FILE}"
fi

if [ "${#AUTHIDS[@]}" -eq 0 ]; then
  echo "ERROR: ไม่มี authid ให้ deploy" >&2
  exit 1
fi

# --- 1) stamp version --------------------------------------------------------
[ -f "${VERSION_FILE}" ] || { echo "ERROR: ไม่มี ${VERSION_FILE}" >&2; exit 1; }
VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo 'nogit')"
DIRTY=""
git -C "${REPO_ROOT}" diff --quiet 2>/dev/null || DIRTY="+dirty"
BUILT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "${APP_DIR}"
printf '{"version":"%s","sha":"%s%s","built":"%s"}\n' \
  "${VERSION}" "${SHA}" "${DIRTY}" "${BUILT}" > "${STAMP_FILE}"

echo "════════════════════════════════════════════════════════════"
echo " PLD deploy  ·  version ${VERSION}  ·  sha ${SHA}${DIRTY}  ·  ${BUILT}"
echo " mode: $([ "${DRYRUN}" -eq 1 ] && echo 'DRYRUN (ไม่ deploy จริง)' || echo 'DEPLOY')"
echo " targets (${#AUTHIDS[@]}): ${AUTHIDS[*]}"
echo "════════════════════════════════════════════════════════════"

# --- 2) backup project.json + คืนค่าเสมอตอนจบ (trap) -------------------------
ORIG_PROJECT_JSON=""
HAD_PROJECT_JSON=0
if [ -f "${PROJECT_JSON}" ]; then
  HAD_PROJECT_JSON=1
  ORIG_PROJECT_JSON="$(cat "${PROJECT_JSON}")"
fi
# shellcheck disable=SC2317,SC2329  # เรียกผ่าน trap ... EXIT — body ไม่ได้ unreachable (shellcheck มองไม่เห็น indirect call)
restore_project_json() {
  if [ "${HAD_PROJECT_JSON}" -eq 1 ]; then
    printf '%s' "${ORIG_PROJECT_JSON}" > "${PROJECT_JSON}"
  else
    rm -f "${PROJECT_JSON}"
  fi
}
trap restore_project_json EXIT

# --- 3) deploy loop ----------------------------------------------------------
LOG_DIR="$(mktemp -d)"
RESULTS=()   # "authid\tPASS|FAIL\tlogpath"
FAILED=0

for authid in "${AUTHIDS[@]}"; do
  echo ""
  echo "──▶ ${authid}"
  printf '{"defaultAuthId":"%s"}\n' "${authid}" > "${PROJECT_JSON}"
  log="${LOG_DIR}/${authid}.log"

  deploy_args=()
  [ "${DRYRUN}" -eq 1 ] && deploy_args+=(--dryrun)

  rc=0
  ( cd "${ENGINE_DIR}" && echo "y" | suitecloud project:deploy "${deploy_args[@]}" ) > "${log}" 2>&1 || rc=$?

  # pass = exit 0 และ (dryrun ก็พอ / deploy จริงต้องเห็น "Installation COMPLETE")
  if [ "${rc}" -eq 0 ] && { [ "${DRYRUN}" -eq 1 ] || grep -qi "Installation COMPLETE" "${log}"; }; then
    echo "    ✓ ${authid} — $([ "${DRYRUN}" -eq 1 ] && echo 'dryrun OK' || echo 'Installation COMPLETE')"
    RESULTS+=("${authid}"$'\t'"PASS"$'\t'"${log}")
  else
    echo "    ✗ ${authid} — FAILED (rc=${rc}) — log: ${log}"
    tail -6 "${log}" | sed 's/^/      /'
    RESULTS+=("${authid}"$'\t'"FAIL"$'\t'"${log}")
    FAILED=1
  fi
done

# --- 4) summary --------------------------------------------------------------
echo ""
echo "════════════════════════════════════════════════════════════"
echo " สรุปผล deploy — version ${VERSION} (${SHA}${DIRTY})"
echo "════════════════════════════════════════════════════════════"
for row in "${RESULTS[@]}"; do
  authid="${row%%$'\t'*}"
  rest="${row#*$'\t'}"
  status="${rest%%$'\t'*}"
  printf '  %-6s  %s\n' "${status}" "${authid}"
done
echo "────────────────────────────────────────────────────────────"
echo "  logs: ${LOG_DIR}"

if [ "${FAILED}" -eq 0 ]; then
  echo "  ✓ ทุก account สำเร็จ"
  exit 0
else
  echo "  ✗ มี account ที่ล้มเหลว"
  exit 1
fi
