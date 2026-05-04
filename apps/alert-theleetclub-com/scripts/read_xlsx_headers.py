"""One-off: print sheet names and row 3 (1-based) = index 2 in 0-based for Red Flags / Admin."""
from __future__ import annotations

import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

# xlsx: shared strings + sheet XML; minimal reader for first few rows


def col_letters_to_index(col: str) -> int:
    n = 0
    for c in col:
        n = n * 26 + (ord(c.upper()) - ord("A") + 1)
    return n - 1


def parse_cell_ref(ref: str) -> tuple[int, int]:
    m = re.match(r"^([A-Z]+)(\d+)$", ref, re.I)
    if not m:
        return 0, 0
    return col_letters_to_index(m.group(1)), int(m.group(2)) - 1


def load_shared_strings(z: zipfile.ZipFile) -> list[str]:
    try:
        data = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(data)
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    out: list[str] = []
    for si in root.findall(".//m:si", ns):
        parts: list[str] = []
        for t in si.findall(".//m:t", ns):
            if t.text:
                parts.append(t.text)
        out.append("".join(parts))
    return out


def read_sheet_rows(z: zipfile.ZipFile, sheet_path: str, max_row: int = 5) -> list[list[str]]:
    data = z.read(sheet_path)
    root = ET.fromstring(data)
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    sst = load_shared_strings(z)
    grid: dict[tuple[int, int], str] = {}
    max_c, max_r = 0, 0
    for c in root.findall(".//m:c", ns):
        ref = c.get("r")
        if not ref:
            continue
        col_i, row_i = parse_cell_ref(ref)
        if row_i >= max_row:
            continue
        t = c.get("t")
        v_el = c.find("m:v", ns)
        if v_el is None or v_el.text is None:
            continue
        val = v_el.text
        if t == "s":
            try:
                val = sst[int(val)]
            except (ValueError, IndexError):
                pass
        grid[(row_i, col_i)] = str(val)
        max_c = max(max_c, col_i)
        max_r = max(max_r, row_i)
    rows: list[list[str]] = []
    for r in range(max_row):
        row_vals: list[str] = []
        for c in range(max_c + 1):
            row_vals.append(grid.get((r, c), ""))
        if any(x.strip() for x in row_vals):
            rows.append(row_vals)
    return rows


def main() -> None:
    xlsx = Path(__file__).resolve().parent.parent / "alert.theleetclub.com.xlsx"
    if not xlsx.is_file():
        print("Missing", xlsx, file=sys.stderr)
        sys.exit(1)
    with zipfile.ZipFile(xlsx) as z:
        # sheet order from workbook.xml
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
              "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        relmap: dict[str, str] = {}
        for el in rels:
            if el.tag.endswith("Relationship"):
                relmap[el.get("Id") or ""] = el.get("Target") or ""
        print("File:", xlsx)
        for sh in wb.findall(".//m:sheet", ns):
            name = sh.get("name") or "?"
            rid = sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            target = relmap.get(rid or "", "")
            if not target.startswith("/"):
                path = "xl/" + target
            else:
                path = target.lstrip("/")
            print(f"\n=== Sheet: {name!r}  ({path}) ===")
            try:
                rows = read_sheet_rows(z, path, max_row=6)
            except KeyError as e:
                print("  (could not read)", e)
                continue
            for i, row in enumerate(rows[:6], start=1):
                cells = [c.strip() for c in row if c is not None]
                while cells and not cells[-1]:
                    cells.pop()
                print(f"  row{i}: {cells}")


if __name__ == "__main__":
    main()
