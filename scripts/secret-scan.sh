#!/usr/bin/env bash
# secret-scan.sh — gitleaks gate ก่อน commit และใน CI (Golden Rule R6)
# canonical source: teibto-dev-standards/scripts/secret-scan.sh — DO NOT edit per-repo
# แก้/อัปเดตที่ teibto-dev-standards เท่านั้น แล้วให้ repo ปลายทาง copy เวอร์ชันใหม่
# minimum supported gitleaks: v8.19.0 (ต้องมี subcommand `dir`)
# @author Wichit Wongta @since 2026-07-10
set -euo pipefail

MIN_GITLEAKS_VERSION="8.19.0"

# --- 0) ตรวจว่ามี gitleaks และเวอร์ชันไม่ต่ำกว่าที่รองรับ -------------------
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "ERROR: gitleaks not installed — install v${MIN_GITLEAKS_VERSION}+ from the official gitleaks release" >&2
  exit 1
fi

GITLEAKS_VERSION="$(gitleaks version 2>/dev/null | tr -d '[:space:]')"
echo "gitleaks version: ${GITLEAKS_VERSION} (minimum supported: ${MIN_GITLEAKS_VERSION})"

# เทียบเวอร์ชันแบบ semantic (sort -V): ตัวที่เล็กสุดต้องเป็น MIN จึงจะผ่าน
if [ "$(printf '%s\n%s\n' "${MIN_GITLEAKS_VERSION}" "${GITLEAKS_VERSION}" | sort -V | head -n1)" != "${MIN_GITLEAKS_VERSION}" ]; then
  echo "ERROR: gitleaks ${GITLEAKS_VERSION} is older than minimum supported ${MIN_GITLEAKS_VERSION}" >&2
  echo "       (subcommand 'dir' requires v8.19+) — upgrade gitleaks" >&2
  exit 1
fi

# --- 1) ตรวจ working tree รวม untracked files --------------------------------
# จุดสำคัญ: ก่อน first commit ห้ามใช้ `gitleaks git` เพราะ history ยังว่าง จะตรวจไม่เจออะไร
echo "[1/2] scanning working tree (includes untracked files)..."
gitleaks dir . --no-banner --redact

# --- 2) ตรวจ staged snapshot แยกต่างหาก --------------------------------------
# เพื่อให้ตรงกับ "สิ่งที่จะ commit จริง" — working tree กับ staged อาจต่างกันได้
# หมายเหตุ: ตอน first commit ที่เพิ่ง `git add -A` สองรอบนี้แทบซ้ำกัน — ตั้งใจให้ซ้ำ
# เพราะรอบถัดไป staged อาจต่างจาก working tree และ cost ของ scan ต่ำกว่า cost ของ secret หลุด
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "[2/2] scanning staged snapshot..."
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT
  git checkout-index --all --prefix="${tmp_dir}/"
  if [ -z "$(ls -A "${tmp_dir}" 2>/dev/null)" ]; then
    echo "      (staged snapshot empty — nothing staged yet, skipped)"
  else
    gitleaks dir "${tmp_dir}" --no-banner --redact
  fi
else
  echo "[2/2] not a git repository — staged scan skipped"
fi

echo "PASS: no secrets detected in working tree or staged snapshot"
