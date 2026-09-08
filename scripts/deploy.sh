#!/usr/bin/env bash
# deploy.sh — deploy SDF engine เข้าหลาย NetSuite account ด้วยคำสั่งเดียว + stamp version (#11)
#
# suitecloud project:deploy ไม่มี flag --authid — มันอ่าน defaultAuthId จาก engine/project.json
# เท่านั้น. multi-account จึงทำโดย loop: เขียน defaultAuthId ใหม่ต่อ account → deploy → คืนค่าเดิม.
# ก่อน loop จะ stamp engine/VERSION + git sha + UTC ลงไฟล์ใน File Cabinet เพื่อให้ตรวจ version
# ที่ deploy ไปได้จากตัว account เอง (?action=version หรือเปิดไฟล์ใน File Cabinet).
#
# ไฟล์ฟอนต์ (fonts/*.ttf) ถูก "ข้าม" โดยค่าเริ่มต้น (#167): การอัปโหลดทับทำให้ token h= ใน URL
# ของไฟล์เปลี่ยน — config ที่เก็บ URL ดิบจะกลายเป็นของเก่าเงียบ ๆ แล้วตัวอักษรไทยหายทั้งใบ
# (engine resolve URL สดจาก file id ให้แล้ว แต่การไม่อัปโหลดซ้ำก็เร็วกว่าและปลอดภัยกว่า)
# ติดตั้งฟอนต์ครั้งแรกหรือเปลี่ยนไฟล์ฟอนต์ → ใส่ --with-fonts
#
# ใช้:
#   scripts/deploy.sh                    # deploy ทุก authid ใน engine/deploy-targets.txt (ไม่แตะฟอนต์)
#   scripts/deploy.sh --with-fonts       # รวมไฟล์ฟอนต์ด้วย (ครั้งแรก / เปลี่ยนไฟล์ฟอนต์)
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
DEPLOY_XML="${ENGINE_DIR}/src/deploy.xml"
# shellcheck disable=SC2088  # `~/` เป็น syntax ของ SDF deploy.xml (project-relative) ไม่ใช่ path ของ shell — ต้องไม่ expand
FC_PREFIX="~/FileCabinet/SuiteScripts/pdf-layout-designer"
DESIGNER_DIR="${REPO_ROOT}/designer"
DIST_SRC="${DESIGNER_DIR}/dist-netsuite"      # vite --mode netsuite output
DIST_DEST="${APP_DIR}/dist"                   # File Cabinet path served by pld_sl_designer.js

# --- 0) parse args -----------------------------------------------------------
DRYRUN=0
NO_BUILD=0
WITH_FONTS=0
AUTHIDS=()
for arg in "$@"; do
  case "$arg" in
    --dryrun) DRYRUN=1 ;;
    --with-fonts) WITH_FONTS=1 ;;   # อัปโหลด fonts/*.ttf ด้วย (ครั้งแรก/เปลี่ยนฟอนต์) — #167
    --no-build) NO_BUILD=1 ;;   # reuse existing designer/dist-netsuite (เร็ว ตอน iterate)
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

# --- 1) build + verify before version stamp -----------------------------------
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required for build provenance" >&2; exit 1; }
PROVENANCE="${SCRIPT_DIR}/build-provenance.mjs"

# --- 1b) build + stage designer SPA bundle เข้า File Cabinet path (#39) --------
# pld_sl_designer.js serve dist/ จาก File Cabinet ด้วย path — bundle ต้องอยู่ใน deploy scope
# (ทำครั้งเดียวก่อน loop; dist/ เป็น build artifact — gitignore, สร้างใหม่ทุก deploy)
if [ "${NO_BUILD}" -eq 1 ]; then
  echo "▶ --no-build: ใช้ ${DIST_SRC} เดิม"
  [ -d "${DIST_SRC}" ] || { echo "ERROR: --no-build แต่ไม่มี ${DIST_SRC} — รัน build ก่อน" >&2; exit 1; }
else
  echo "▶ building designer SPA (npm run build:netsuite)…"
  command -v npm >/dev/null 2>&1 || { echo "ERROR: ต้องมี npm เพื่อ build designer bundle (หรือใช้ --no-build)" >&2; exit 1; }
  ( cd "${DESIGNER_DIR}" && npm run build:netsuite ) > "${DESIGNER_DIR}/.deploy-build.log" 2>&1 \
    || { echo "ERROR: designer build ล้มเหลว — ดู ${DESIGNER_DIR}/.deploy-build.log" >&2; tail -8 "${DESIGNER_DIR}/.deploy-build.log" >&2; exit 1; }
fi
[ -f "${DIST_SRC}/index.html" ] || { echo "ERROR: ไม่พบ ${DIST_SRC}/index.html หลัง build" >&2; exit 1; }
node "${PROVENANCE}" stage "${REPO_ROOT}"
# Stamp only after both source and staged asset hashes have been verified.
node "${PROVENANCE}" stamp "${REPO_ROOT}" >/dev/null
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "${STAMP_FILE}")"
SHA="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sha' "${STAMP_FILE}")"
DIRTY=""
BUILT="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).built' "${STAMP_FILE}")"
echo "▶ verified and staged SPA → ${DIST_DEST}"

echo "════════════════════════════════════════════════════════════"
echo " PLD deploy  ·  version ${VERSION}  ·  sha ${SHA}${DIRTY}  ·  ${BUILT}"
echo " mode: $([ "${DRYRUN}" -eq 1 ] && echo 'DRYRUN (ไม่ deploy จริง)' || echo 'DEPLOY')"
echo " targets (${#AUTHIDS[@]}): ${AUTHIDS[*]}"
echo "════════════════════════════════════════════════════════════"

# --- 2) backup project.json + deploy.xml แล้วคืนค่าเสมอตอนจบ (trap) ----------
# backup เป็นไฟล์จริงแล้ว cp กลับ — คืนค่าแบบ byte-exact (เดิมใช้ printf '%s' ทำให้ newline
# ท้ายไฟล์หาย แล้ว deploy.xml ที่ version control ไว้ขึ้น modified ทุกครั้งที่รัน)
BACKUP_DIR="$(mktemp -d)"
HAD_PROJECT_JSON=0
if [ -f "${PROJECT_JSON}" ]; then
  HAD_PROJECT_JSON=1
  cp "${PROJECT_JSON}" "${BACKUP_DIR}/project.json"
fi
cp "${DEPLOY_XML}" "${BACKUP_DIR}/deploy.xml"
# shellcheck disable=SC2317,SC2329  # เรียกผ่าน trap ... EXIT — body ไม่ได้ unreachable (shellcheck มองไม่เห็น indirect call)
restore_repo_files() {
  if [ "${HAD_PROJECT_JSON}" -eq 1 ]; then
    cp "${BACKUP_DIR}/project.json" "${PROJECT_JSON}"
  else
    rm -f "${PROJECT_JSON}"
  fi
  cp "${BACKUP_DIR}/deploy.xml" "${DEPLOY_XML}"
  rm -f "${BACKUP_DIR}/project.json" "${BACKUP_DIR}/deploy.xml"
  rmdir "${BACKUP_DIR}"
}
trap restore_repo_files EXIT

# --- 2b) deploy scope: ข้ามไฟล์ฟอนต์เว้นแต่สั่ง --with-fonts (#167) -----------
# deploy.xml ใน repo กวาดโฟลเดอร์ทั้งก้อน (`pdf-layout-designer/*`) ซึ่งรวม fonts/ ด้วย —
# อัปโหลดทับทำให้ token h= ใน URL เปลี่ยน (config ที่เก็บ URL ดิบจะชี้ของเก่า → ไทยหายเงียบ)
# ปกติจึงเขียน deploy.xml ชั่วคราวที่ระบุไฟล์เอง แล้ว trap ข้างบนคืนไฟล์เดิมให้เสมอ
if [ "${WITH_FONTS}" -eq 1 ]; then
  echo "▶ scope: ทั้งโฟลเดอร์ รวมไฟล์ฟอนต์ (--with-fonts) — หลัง deploy ตรวจว่า URL/​file id ฟอนต์ใน config ยังใช้ได้"
else
  {
    echo '<deploy>'
    echo '  <files>'
    for f in "${APP_DIR}"/*.js; do
      [ -f "$f" ] && echo "    <path>${FC_PREFIX}/$(basename "$f")</path>"
    done
    [ -f "${STAMP_FILE}" ] && echo "    <path>${FC_PREFIX}/$(basename "${STAMP_FILE}")</path>"
    [ -d "${DIST_DEST}" ] && echo "    <path>${FC_PREFIX}/dist/*</path>"
    echo '  </files>'
    echo '  <objects>'
    echo '    <path>~/Objects/*</path>'
    echo '  </objects>'
    echo '</deploy>'
  } > "${DEPLOY_XML}"
  echo "▶ scope: script + SPA + objects · ข้ามไฟล์ฟอนต์ (#167 — ใช้ --with-fonts ถ้าต้องอัปโหลดฟอนต์)"
fi

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
