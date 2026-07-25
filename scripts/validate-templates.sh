#!/usr/bin/env bash
# validate-templates.sh — gate ให้ template pack ปลอดกับดัก BFO/FreeMarker ตั้งแต่ CI
# ครอบกับดักที่พิสูจน์จริงใน docs/TOOLSTACK.md (#1 ternary, #2 null-safe, #4/#11/#32 font,
# #5 CSS เมินเงียบ, #10 div) — bug พวกนี้ render ผ่านแต่พังเงียบที่หน้างานลูกค้า
# รัน local: bash scripts/validate-templates.sh
# @author Wichit Wongta @since 2026-07-17
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# override ได้ผ่าน arg เพื่อทดสอบ (bash scripts/validate-templates.sh <master_dir> <sample_dir> <engine_lib>)
MASTER_DIR="${1:-$ROOT/templates/master}"
SAMPLE_DIR="${2:-$ROOT/templates/samples}"
# lib ที่ประกาศ binding contract ของ engine (#155) — validator อ่านรายชื่อ key จากไฟล์นี้
ENGINE_LIB="${3:-$ROOT/engine/src/FileCabinet/SuiteScripts/pdf-layout-designer/pld_lib_invoice_data.js}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 required for template validation" >&2
  exit 1
fi

python3 - "$MASTER_DIR" "$SAMPLE_DIR" "$ENGINE_LIB" <<'PYEOF'
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
engine_lib = Path(sys.argv[3]) if len(sys.argv) > 3 else None
errors = []   # (file, message) — block PR
checked = 0

# ── regex ต่อกับดัก (อ้าง docs/TOOLSTACK.md) ──────────────────────────────
INTERP = re.compile(r'\$\{.*?\}', re.DOTALL)                # ${ ... }
FIELD_BINDING = re.compile(r'^\s*(record|line|company)\.[A-Za-z0-9_]+\s*$')
DATA_BINDING = re.compile(r'(^|[^A-Za-z0-9_.])(record|line|company|copy)\.')  # ค่าที่มาจากข้อมูล (#184)
XML_BUILTIN = re.compile(r'\?xml\s*$')                      # ?xml ต้องเป็น builtin ตัวสุดท้าย
FONT_LINK = re.compile(r'<link\b[^>]*type\s*=\s*"font"[^>]*>', re.IGNORECASE | re.DOTALL)
FORBIDDEN_CSS = {
    'object-fit': r'object-fit',                            # #5 BFO เมินเงียบ
    'text-overflow': r'text-overflow',                     # #5
    '-webkit-*': r'-webkit-',                              # #5
    '@page margin box': r'@page\b[^{]*\{[^}]*@(?:top|bottom|left|right)-',  # #3
    'counter(page)': r'counter\s*\(\s*page\s*\)',          # #3
}

def strip_comments(src: str) -> str:
    """ตัด comment ทั้ง XML และ FreeMarker ทิ้ง — ตัวอย่างโค้ดใน comment ไม่ใช่ binding จริง"""
    return re.sub(r'<!--.*?-->|<#--.*?-->', '', src, flags=re.DOTALL)


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

# ── binding contract ของ engine (#155) ────────────────────────────────────────
# rectype ที่ engine curate จะถูก bind ด้วย object จาก pld_lib_invoice_data (แทน record
# ดิบของ NetSuite) — master ที่อ้าง key นอก contract จึงพิมพ์ออกมา "ว่าง" ไม่ error
# เพราะ binding null-safe (#2) กลืนให้หมด กับดักนี้ต้องตายที่ PR ไม่ใช่ที่หน้างานลูกค้า
RECTYPE_MARKER = re.compile(r'pld:rectype\s+([A-Za-z_][A-Za-z0-9_]*)')
RECORD_KEY = re.compile(r'record\.([A-Za-z_][A-Za-z0-9_]*)')
LINE_KEY = re.compile(r'line\.([A-Za-z_][A-Za-z0-9_]*)')
COPY_KEY = re.compile(r'\bcopy\.([A-Za-z_][A-Za-z0-9_]*)')

def js_string_list(src: str, var_name: str):
    """ดึงรายชื่อ string จาก `var NAME = [ 'a', 'b' ];` ใน source ของ engine lib.
    ตัด // comment ออกก่อน — คำอธิบายในลิสต์ที่มี quote ทำให้ parser กินเลย (เจอจริง #165)."""
    m = re.search(r'var\s+' + var_name + r'\s*=\s*\[(.*?)\]\s*;', src, re.DOTALL)
    if not m:
        return None
    body = re.sub(r'//[^\n]*', '', m.group(1))
    return re.findall(r"'([^']+)'", body)

def js_object_keys(src: str, var_name: str):
    """ดึง key ระดับบนสุดจาก `var NAME = { key: {...}, ... };` (ใช้กับ DOC_TITLES)."""
    m = re.search(r'var\s+' + var_name + r'\s*=\s*\{(.*?)\n\s*\}\s*;', src, re.DOTALL)
    if not m:
        return None
    return re.findall(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:', m.group(1), re.M)

engine_contract = None
if engine_lib and engine_lib.is_file():
    eng = engine_lib.read_text(encoding='utf-8')
    curated = js_string_list(eng, 'CURATED_KEYS')
    aliases = js_string_list(eng, 'RAW_ALIAS_KEYS')
    item_keys = js_string_list(eng, 'ITEM_BINDING_KEYS')
    copy_keys = js_string_list(eng, 'COPY_BINDING_KEYS')
    curated_types = js_object_keys(eng, 'DOC_TITLES')
    if None in (curated, aliases, item_keys, copy_keys, curated_types):
        errors.append((engine_lib.name,
                       'อ่าน binding contract ไม่ได้ (CURATED_KEYS / RAW_ALIAS_KEYS / '
                       'ITEM_BINDING_KEYS / COPY_BINDING_KEYS / DOC_TITLES) — validator กับ engine หลุด sync (#155)'))
    else:
        engine_contract = {
            'record': set(curated) | set(aliases),
            'line': set(item_keys),
            'copy': set(copy_keys),
            'types': set(curated_types),
        }

def check_binding_contract(path: Path, src: str, name: str):
    marker = RECTYPE_MARKER.search(src)
    if not marker:
        errors.append((name, 'ไม่มี marker `pld:rectype <recordtype>` ใน comment หัวไฟล์ — '
                             'validator ต้องรู้ว่า template นี้เรนเดอร์ผ่าน curated หรือ raw binding (#155)'))
        return
    if engine_contract is None:
        return

    # ${copy.*} มาจาก data source ที่ engine ใส่ให้ทุก render pass — ใช้ได้ทุก rectype (#159)
    for key in sorted(set(COPY_KEY.findall(src))):
        if key not in engine_contract['copy']:
            errors.append((name, f'${{copy.{key}}} ไม่มีใน COPY_BINDING_KEYS ของ engine — '
                                 f'ป้ายชุดเอกสารจะพิมพ์ว่างเงียบ ๆ (#159)'))

    rectype = marker.group(1)
    # rectype ที่ engine ไม่ curate ใช้ record ดิบของ NetSuite — ${record.tranid} /
    # <#list record.item> resolve ได้เองตาม schema ของ record นั้น (ดู #159)
    if rectype not in engine_contract['types']:
        return

    for key in sorted(set(RECORD_KEY.findall(src))):
        if key not in engine_contract['record']:
            errors.append((name, f'${{record.{key}}} ไม่มีใน binding contract ของ engine '
                                 f'(rectype {rectype} bind curated schema) — จะพิมพ์ว่างเงียบ ๆ '
                                 f'เพิ่ม alias ใน pld_lib_invoice_data.js หรือเปลี่ยน binding (#155)'))
    for key in sorted(set(LINE_KEY.findall(src))):
        if key not in engine_contract['line']:
            errors.append((name, f'${{line.{key}}} ไม่มีใน ITEM_BINDING_KEYS ของ engine — '
                                 f'แถวในตารางจะพิมพ์ว่างเงียบ ๆ (#155)'))

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

    # 3b) ทุก binding ของข้อมูลต้องผ่าน ?xml (#184)
    #     BFO parse ผลลัพธ์ของ FreeMarker เป็น XML อีกที ค่าที่มี & หรือ < จาก
    #     ข้อมูลจริง (คำอธิบายสินค้า "Laser & Inkjet", ชื่อบริษัท "A & B") จึงทำให้
    #     **ทั้งเอกสาร** พิมพ์ไม่ออก ไม่ใช่แค่ช่องนั้น — engine escape ให้ไม่ได้
    #     เพราะ rectype ที่ยังไม่ curate bind record ดิบตรง ๆ
    for interp in INTERP.findall(strip_comments(src)):
        body = interp[2:-1].strip()
        if not DATA_BINDING.search(body):      # ${line_index + 1} ฯลฯ ไม่ใช่ข้อมูล
            continue
        if XML_BUILTIN.search(body):
            continue
        errors.append((name, f'binding ไม่ผ่าน ?xml {interp.strip()[:60]} — ข้อมูลที่มี & หรือ < '
                             f'ทำให้พิมพ์ไม่ออกทั้งใบ ใช้ ${{({body})?xml}} (#184)'))

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

    # 7) binding ต้องอยู่ใน contract ที่ engine bind จริง (#155)
    check_binding_contract(path, src, name)

    # 8) ห้าม format ตัวเลขใน template (#165) — ทุกค่าที่ผ่าน data source ของ N/render
    #    ถึง FreeMarker เป็น string เสมอ (พิสูจน์บน SB2: is_number = NO) ดังนั้น
    #    ?string("#,##0.00") / ?string["#,##0.00"] คืนค่าว่างโดยไม่ error → ช่องเงินว่างเงียบ
    for m in re.finditer(r'\?string\s*[\[(]', src):
        snippet = src[max(0, m.start() - 40):m.end() + 12].replace('\n', ' ')
        errors.append((name, f'format ตัวเลขใน template (`?string(...)`) — ค่าจาก data source '
                             f'เป็น string เสมอ จึงคืนค่าว่างเงียบ ๆ ให้ engine format มาแล้วพิมพ์ตรง ๆ '
                             f'(เช่น ${{record.totalText}}) (#165) · ใกล้: …{snippet.strip()}…'))
    #    เลขคณิตกับ binding ก็พังด้วยเหตุเดียวกัน — ตัวอักษรไทยต้องมาจาก engine
    if 'pldBahtText(' in src:
        errors.append((name, 'เรียก pldBahtText() ใน template — ทำเลขคณิตกับค่าที่เป็น string '
                             'จึงคืนค่าว่างเสมอ ใช้ ${record.bahtText} ที่ engine คำนวณให้ (#165)'))

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

contract_note = ('binding contract จาก engine' if engine_contract
                 else 'ข้าม binding contract (ไม่พบ engine lib)')
print(f'validate-templates: ตรวจ {len(masters)} template + {len(samples)} sample · {contract_note}')
if errors:
    print(f'\n❌ พบ {len(errors)} ปัญหา:')
    for f, msg in errors:
        print(f'  [{f}] {msg}')
    sys.exit(1)
print('✅ ผ่านทุกไฟล์ — ไม่พบกับดัก BFO/FreeMarker')
PYEOF
