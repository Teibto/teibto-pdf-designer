#!/usr/bin/env bash
# validate-templates.sh — gate ให้ template pack ปลอดกับดัก BFO/FreeMarker ตั้งแต่ CI
# ครอบกับดักที่พิสูจน์จริงใน docs/TOOLSTACK.md (#1 ternary, #2 null-safe, #4/#11/#32 font,
# #5 CSS เมินเงียบ, #10 div) — bug พวกนี้ render ผ่านแต่พังเงียบที่หน้างานลูกค้า
# รัน local: bash scripts/validate-templates.sh
# @author Wichit Wongta @since 2026-07-17
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# override ได้ผ่าน arg เพื่อทดสอบ (bash scripts/validate-templates.sh <master_dir> <sample_dir>)
MASTER_DIR="${1:-$ROOT/templates/master}"
SAMPLE_DIR="${2:-$ROOT/templates/samples}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 required for template validation" >&2
  exit 1
fi

python3 - "$MASTER_DIR" "$SAMPLE_DIR" <<'PYEOF'
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8')   # Windows stdout = cp1252 พิมพ์ไทยไม่ได้
except AttributeError:
    pass

master_dir, sample_dir = Path(sys.argv[1]), Path(sys.argv[2])
errors = []   # (file, message) — block PR
checked = 0

# ── regex ต่อกับดัก (อ้าง docs/TOOLSTACK.md) ──────────────────────────────
INTERP = re.compile(r'\$\{.*?\}', re.DOTALL)                # ${ ... }
FIELD_BINDING = re.compile(r'^\s*(record|line|company)\.[A-Za-z0-9_]+\s*$')
FONT_LINK = re.compile(r'<link\b[^>]*type\s*=\s*"font"[^>]*>', re.IGNORECASE | re.DOTALL)
FORBIDDEN_CSS = {
    'object-fit': r'object-fit',                            # #5 BFO เมินเงียบ
    'text-overflow': r'text-overflow',                     # #5
    '-webkit-*': r'-webkit-',                              # #5
    '@page margin box': r'@page\b[^{]*\{[^}]*@(?:top|bottom|left|right)-',  # #3
    'counter(page)': r'counter\s*\(\s*page\s*\)',          # #3
}

def mask_freemarker(src: str) -> str:
    """ตัด FreeMarker ออกให้เหลือ XML ล้วน แล้วเช็ค well-formed (#well-formed)."""
    s = re.sub(r'<!DOCTYPE[^>]*>', '', src)
    s = re.sub(r'\$\{.*?\}', 'X', s, flags=re.DOTALL)       # ${...} -> text
    s = re.sub(r'</?#[^>]*>', '', s)                        # <#...> </#...>
    s = re.sub(r'</?@[^>]*>', '', s)                        # <@...> </@...>
    return s

def is_c_ternary(interp: str) -> bool:
    """${cond ? a : b} = FreeMarker parse error (#1). builtin คือ ?identifier เสมอ —
    ternary คือ ? ตามด้วยอะไรที่ไม่ใช่ตัวอักษร แล้วมี : ตามมาใน ${} เดียวกัน."""
    body = interp[2:-1]
    for m in re.finditer(r'\?', body):
        nxt = body[m.end():m.end() + 1]
        if nxt[:1].isalpha():          # ?then ?int ?string ?xml ?c ... = builtin
            continue
        if ':' in body[m.end():]:      # ? <non-letter> ... : ...  = C-ternary
            return True
    return False

def check_template(path: Path):
    src = path.read_text(encoding='utf-8')
    name = path.name

    # 1) well-formed XML (หลัง mask FreeMarker)
    masked = mask_freemarker(src)
    start = masked.find('<pdf')
    try:
        ET.fromstring(masked[start:] if start >= 0 else masked)
    except ET.ParseError as e:
        errors.append((name, f'XML ไม่ well-formed: {e}'))

    # 2) C-ternary ใน ${...} (#1)
    for interp in INTERP.findall(src):
        if is_c_ternary(interp):
            errors.append((name, f'C-ternary ใน {interp.strip()[:60]} — ใช้ ?then(a,b) หรือ <#if> (#1)'))

    # 3) null-safety: binding record/line/company ตรง ๆ ต้องมี ! (#2)
    #    ข้ามถ้า field เดียวกันมี ! ที่อื่นในไฟล์ (แปลว่าถูก guard ด้วย <#if (x!"") != "">
    #    หรือ default ไว้แล้ว — bare binding ใน block นั้นตั้งใจและปลอดภัย)
    for interp in INTERP.findall(src):
        m = FIELD_BINDING.match(interp[2:-1])
        if m and (m.group(0).strip() + '!') not in src:
            errors.append((name, f'binding ไม่ null-safe {interp.strip()} — ต้องมี ! เช่น {interp[:-1]}!""}} (#2)'))

    # 4) ฟอนต์ต้องมาจาก config ${company.font*} ห้าม bake URL/placeholder (#4/#11/#32)
    for link in FONT_LINK.findall(src):
        if 'company.fontRegular' not in link:
            errors.append((name, 'font <link> ไม่ได้อ้าง ${company.fontRegular} — ห้าม bake URL/ฟอนต์ต่อ template (BFO ไม่ apply GPOS → ฟอนต์ผิดพังเงียบ #32); ให้ config layer จ่ายฟอนต์'))
        elif '?xml' not in link:
            errors.append((name, 'font <link> src ไม่ผ่าน ?xml — ค่า config มี & ดิบ BFO parse พัง'))

    # 5) CSS ที่ BFO เมินเงียบ (#5) + @page margin box (#3)
    for label, pat in FORBIDDEN_CSS.items():
        if re.search(pat, src, re.IGNORECASE):
            errors.append((name, f'CSS ต้องห้าม `{label}` — BFO ไม่รองรับ/เมินเงียบ (TOOLSTACK #3/#5)'))

    # 6) <div> ระดับ body ถูก BFO ทิ้งเงียบ — ใช้ <p>/<table> (#10)
    if re.search(r'<div\b', src, re.IGNORECASE):
        errors.append((name, '<div> — BFO ทิ้งทั้ง element เงียบ ใช้ <p>/<table> เท่านั้น (#10)'))

def check_sample(path: Path):
    try:
        json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        errors.append((path.name, f'sample JSON parse ไม่ได้: {e}'))

masters = sorted(master_dir.glob('*.xml'))
samples = sorted(sample_dir.glob('*.json'))
if not masters:
    errors.append(('templates/master', 'ไม่พบไฟล์ .xml — validate ต้องมี template อย่างน้อย 1 ไฟล์'))

for p in masters:
    check_template(p)
    checked += 1
for p in samples:
    check_sample(p)
    checked += 1

print(f'validate-templates: ตรวจ {len(masters)} template + {len(samples)} sample')
if errors:
    print(f'\n❌ พบ {len(errors)} ปัญหา:')
    for f, msg in errors:
        print(f'  [{f}] {msg}')
    sys.exit(1)
print('✅ ผ่านทุกไฟล์ — ไม่พบกับดัก BFO/FreeMarker')
PYEOF
