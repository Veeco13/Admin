# -*- coding: utf-8 -*-
"""
كشوف العهد Excel بهوية التقارير (openpyxl) — ثنائية اللغة لأنها بتروح للشركات (مراكز التكلفة):

- كشف تقفيل عهدة (Custody Closing Statement — Form T-104): شيت «الملخص» (لكل مركز تكلفة + تسوية العهدة مع
  المستلم)، وشيت لكل مركز تكلفة: كشف جماعي (موظف في كل صف وبند في كل عمود)، أو كشف فردي لكل موظف (كل كشف في
  صفحة مطبوعة لوحده) لو المركز فيه موظف واحد أو اتطلب «فردي».
- طلب صرف عهدة (Advance Payment Request): كل الأشخاص وبنودهم + ملخص المطلوب لكل مركز تكلفة.

الأرقام معادلات (SUM) فلو اتعدّل رقم في الشيت الإجمالي بيتحسب تاني. الطباعة جاهزة: A4، عرض الصفحة، رأس الجدول
بيتكرر، و«صفحة X من Y».
"""
import io
import math
import re
from datetime import date, datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select

import custody
import db
import models as M

try:                                          # الشعار محتاج Pillow — من غيره الكشف بيطلع من غير شعار
    from openpyxl.drawing.image import Image as XLImage
    import PIL  # noqa: F401
except ImportError:                           # pragma: no cover
    XLImage = None

PRIMARY, PRIMARY_SOFT, ACCENT, INK, MUTED, LINE, ZEBRA, RED = (
    "1F5C4A", "E3EFEA", "C8963E", "17231F", "5F6F69", "D5DDDA", "F6F8F7", "C0392B")
FONT = "Arial"
KWD = '#,##0.000;-#,##0.000;"–"'
FORM_NO = "Form No. T-104"
NOTE = ("Above charges are based on the actual announced charges of PAM, the Ministry of Interior, the Ministry of Health, "
        "the Ministry of Foreign Affairs and other authorities, and are subject to change if these authorities introduce or "
        "remove charges.\nالمبالغ أعلاه حسب الرسوم الفعلية المعلنة من الهيئة العامة للقوى العاملة ووزارة الداخلية ووزارة الصحة "
        "ووزارة الخارجية والجهات الأخرى، وقابلة للتغيير لو الجهات دي غيّرت رسومها.")


# ---------------------------------------------------------------------------
# أدوات التنسيق
# ---------------------------------------------------------------------------
def _fill(color):
    return PatternFill("solid", start_color=color, end_color=color)


def _side(color=LINE, style="thin"):
    return Side(style=style, color=color)


GRID = Border(left=_side(), right=_side(), top=_side(), bottom=_side())


def _put(ws, row, col, value=None, *, to_col=None, to_row=None, bold=False, size=10, color=INK, fill=None, h="center",
         v="center", wrap=True, fmt=None, border=None, italic=False):
    """قيمة في خانة (ومدمجة لحد to_col / to_row) بتنسيقها كله في سطر واحد."""
    c = ws.cell(row=row, column=col, value=value)
    c.font = Font(name=FONT, size=size, bold=bold, italic=italic, color=color)
    c.alignment = Alignment(horizontal=h, vertical=v, wrap_text=wrap)
    if fill:
        c.fill = _fill(fill)
    if fmt:
        c.number_format = fmt
    last_col, last_row = to_col or col, to_row or row
    if (last_col, last_row) != (col, row):
        ws.merge_cells(start_row=row, start_column=col, end_row=last_row, end_column=last_col)
    if border or fill:
        for r in range(row, last_row + 1):
            for cc in range(col, last_col + 1):
                x = ws.cell(row=r, column=cc)
                if border:
                    x.border = border
                if fill:
                    x.fill = _fill(fill)
    return c


def _widths(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _sheet_name(wb, name):
    name = re.sub(r"[\[\]:*?/\\]", "-", (name or "—").strip())[:28] or "—"
    base, n = name, 2
    while name in wb.sheetnames:
        name = f"{base[:25]} ({n})"
        n += 1
    return name


def _logo(ws, company, anchor="A1", height=58):
    path = db.resolve_file(company.logoPath) if company is not None and company.logoPath else None
    if not (XLImage and path):
        return
    try:
        img = XLImage(path)
    except Exception:                          # صيغة مش مدعومة (SVG …) ← من غير شعار
        return
    ratio = height / float(img.height or height)
    img.height, img.width = height, int((img.width or height) * ratio)
    ws.add_image(img, anchor)


def _header(ws, ncols, company, title_en, title_ar, sub=FORM_NO):
    """الشعار · اسم الشركة عربي وإنجليزي · عنوان الكشف ورقم النموذج، وتحتهم شريط ذهبي."""
    for r, hgt in ((1, 24), (2, 22), (3, 18), (4, 4), (5, 8)):
        ws.row_dimensions[r].height = hgt
    _logo(ws, company)
    title_from = ncols - 2 if ncols >= 7 else ncols - 1
    mid_from, mid_to = 3, max(3, title_from - 1)
    name_en = company.nameEn if company is not None else ""
    name_ar = company.nameAr if company is not None else ""
    _put(ws, 1, mid_from, name_en, to_col=mid_to, bold=True, size=13, color=PRIMARY)
    _put(ws, 2, mid_from, name_ar, to_col=mid_to, bold=True, size=12)
    _put(ws, 3, mid_from, "Admin Unit · إدارة الشؤون الإدارية", to_col=mid_to, size=9, color=MUTED)
    _put(ws, 1, title_from, title_en, to_col=ncols, bold=True, size=12, color=PRIMARY, h="right", wrap=False)
    _put(ws, 2, title_from, title_ar, to_col=ncols, bold=True, size=12, h="right", wrap=False)
    _put(ws, 3, title_from, sub, to_col=ncols, size=9, color=MUTED, h="right")
    for c in range(1, ncols + 1):
        ws.cell(row=4, column=c).fill = _fill(ACCENT)
    return 6


def _info(ws, row, ncols, pairs, box_title, box_note):
    """بيانات الكشف على الشمال (عنوان | قيمة)، وصندوق الإجمالي على اليمين (آخر عمودين).
    بيرجّع (أول سطر بعدها، خانة رقم الصندوق) — الرقم بيتكتب بعد الجدول (معادلة لخانة الإجمالي)."""
    for i, (label, value) in enumerate(pairs):
        r = row + i
        ws.row_dimensions[r].height = 20
        _put(ws, r, 1, label, to_col=2, bold=True, size=9, color=PRIMARY, fill=PRIMARY_SOFT, h="left", border=GRID)
        _put(ws, r, 3, value, to_col=ncols - 2, size=10, h="left", border=GRID)
    last = row + len(pairs) - 1
    ws.row_dimensions[row].height = 30
    _put(ws, row, ncols - 1, box_title.replace(" / ", "\n"), to_col=ncols, bold=True, size=9, color="FFFFFF", fill=PRIMARY,
         border=GRID)
    _put(ws, row + 1, ncols - 1, None, to_col=ncols, to_row=max(row + 1, last - 1), bold=True, size=18, color=PRIMARY,
         fmt=KWD, border=GRID)
    _put(ws, last, ncols - 1, box_note, to_col=ncols, size=9, color=MUTED, fill=PRIMARY_SOFT, border=GRID)
    return last + 2, ws.cell(row=row + 1, column=ncols - 1)


def _table_head(ws, row, headers):
    ws.row_dimensions[row].height = 46
    for i, text in enumerate(headers, 1):
        _put(ws, row, i, text, bold=True, size=9, color="FFFFFF", fill=PRIMARY,
             border=Border(left=_side("FFFFFF"), right=_side("FFFFFF"), top=_side(PRIMARY), bottom=_side(PRIMARY)))


def _lines(ws, col, text):
    if not isinstance(text, str) or text.startswith("="):
        return 1
    width = max((ws.column_dimensions[get_column_letter(col)].width or 10) - 1.5, 4)
    return sum(max(1, math.ceil(len(part) * 1.08 / width)) for part in text.split("\n"))


def _table_row(ws, row, values, money_from, zebra, left_cols=(2,)):
    ws.row_dimensions[row].height = max(20, 13.5 * max(_lines(ws, i, v) for i, v in enumerate(values, 1)) + 5)
    for i, val in enumerate(values, 1):
        money = i >= money_from and not (isinstance(val, str) and not val.startswith("="))
        _put(ws, row, i, val, size=10, fill=ZEBRA if zebra else None, h="left" if i in left_cols else "center",
             fmt=KWD if money else None, border=GRID, color=MUTED if i == 1 else INK)


def _total_row(ws, row, ncols, label, first_row, last_row, money_from, label_to):
    ws.row_dimensions[row].height = 24
    top = Border(left=_side(), right=_side(), top=_side(PRIMARY, "medium"), bottom=_side(PRIMARY, "double"))
    _put(ws, row, 1, label, to_col=label_to, bold=True, size=10, color=PRIMARY, fill=PRIMARY_SOFT, h="left", border=top)
    for c in range(label_to + 1, ncols + 1):
        col = get_column_letter(c)
        value = f"=SUM({col}{first_row}:{col}{last_row})" if c >= money_from else None
        _put(ws, row, c, value, bold=True, size=10, color=PRIMARY, fill=PRIMARY_SOFT, fmt=KWD, border=top)
    return f"{get_column_letter(ncols)}{row}"


def _words(n):
    ones = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
            "seventeen eighteen nineteen").split()
    tens = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
    if n < 20:
        return ones[n]
    if n < 100:
        return tens[n // 10] + ("-" + ones[n % 10] if n % 10 else "")
    if n < 1000:
        return ones[n // 100] + " hundred" + (" and " + _words(n % 100) if n % 100 else "")
    for div, name in ((10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand")):
        if n >= div:
            rest = n % div
            return _words(n // div) + " " + name + ((" and " if rest < 100 else " ") + _words(rest) if rest else "")
    return str(n)


def amount_words(amount):
    """170.25 ← «One hundred and seventy Kuwaiti Dinars and 250 Fils only»"""
    kd, fils = divmod(round(float(amount or 0) * 1000), 1000)
    text = f"{_words(kd).capitalize()} Kuwaiti Dinar{'' if kd == 1 else 's'}"
    return text + (f" and {fils} Fils" if fils else "") + " only"


def _words_row(ws, row, ncols, amount):
    ws.row_dimensions[row].height = 20
    _put(ws, row, 1, f"Amount in words:  {amount_words(amount)}", to_col=ncols, size=9, italic=True,
         color=INK, h="left", border=Border(bottom=_side()))
    return row + 1


def _note(ws, row, ncols):
    ws.row_dimensions[row].height = 36
    _put(ws, row, 1, NOTE, to_col=ncols, size=8, italic=True, color=MUTED, h="left", v="top")
    return row + 2


def _spans(ws, ncols, n):
    """n خانة على عرض الكشف بالتساوي تقريبًا (حسب عرض الأعمدة، مش عددها)."""
    widths = [ws.column_dimensions[get_column_letter(c)].width or 10 for c in range(1, ncols + 1)]
    target, spans, start, acc = sum(widths) / n, [], 1, 0
    for c in range(1, ncols + 1):
        acc += widths[c - 1]
        left_boxes = n - len(spans) - 1
        if left_boxes and ncols - c >= left_boxes and acc >= target * (len(spans) + 1) - widths[c - 1] / 2:
            spans.append((start, c))
            start = c + 1
    spans.append((start, ncols))
    return spans


def _signatures(ws, row, ncols, labels, prepared_by=None):
    """جدول توقيعات: العنوان، مساحة التوقيع، الاسم، التاريخ — كل خانة بإطار."""
    for r, hgt in ((row, 22), (row + 1, 42), (row + 2, 18), (row + 3, 18)):
        ws.row_dimensions[r].height = hgt
    for i, ((a, b), label) in enumerate(zip(_spans(ws, ncols, len(labels)), labels)):
        _put(ws, row, a, label, to_col=b, bold=True, size=9, color=PRIMARY, fill=PRIMARY_SOFT, border=GRID)
        _put(ws, row + 1, a, None, to_col=b, border=GRID)
        name = prepared_by if (i == 0 and prepared_by) else "………………………"
        _put(ws, row + 2, a, f"Name / الاسم:  {name}", to_col=b, size=8, color=MUTED, h="left", border=GRID)
        _put(ws, row + 3, a, "Date / التاريخ:  ……/……/……", to_col=b, size=8, color=MUTED, h="left", border=GRID)
    return row + 4


def _print_setup(ws, landscape, title_row, footer_left):
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.35
    ws.page_margins.top, ws.page_margins.bottom = 0.45, 0.55
    if title_row:
        ws.print_title_rows = f"{title_row}:{title_row}"
    ws.oddFooter.left.text, ws.oddFooter.left.size = footer_left, 8
    ws.oddFooter.center.text, ws.oddFooter.center.size = "Page &P of &N · صفحة &P من &N", 8
    ws.oddFooter.right.text, ws.oddFooter.right.size = "Printed &D &T", 8
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = PRIMARY


# مساحة الطباعة (نقطة) على A4 بالهوامش اللي فوق: (العرض، الطول)
PRINTABLE = {False: (544.9, 769.9), True: (791.5, 523.3)}


def _fit(ws, landscape, title_row, tail_row):
    """لو الشيت أطول من صفحة بحبة ← يتصغّر ويبقى صفحة واحدة. غير كده: لو الجزء الأخير (من tail_row: المبلغ كتابةً
    والملاحظة والتوقيعات) هيتقسم على صفحتين، بيبدأ صفحة جديدة. الحساب تقريبي بنفس طريقة إكسيل (عرض الأعمدة ← التصغير)."""
    from openpyxl.worksheet.pagebreak import Break
    pw, ph = PRINTABLE[landscape]
    width = sum(((ws.column_dimensions[get_column_letter(c)].width or 8.43) * 7 + 5) * 0.75 for c in range(1, ws.max_column + 1))
    scale = min(1.0, pw / width)
    heights = [(ws.row_dimensions[r].height or 15) * scale for r in range(1, ws.max_row + 1)]
    if sum(heights) <= ph * 1.15:
        ws.page_setup.fitToHeight = 1
        return
    repeat = heights[title_row - 1] if title_row else 0
    used = 0
    for r in range(1, tail_row):
        h = heights[r - 1]
        used = repeat + h if used + h > ph else used + h
    block = sum(heights[tail_row - 1:])
    if used + block > ph and block <= ph - repeat:
        ws.row_breaks.append(Break(id=tail_row - 1))


# ---------------------------------------------------------------------------
# البيانات
# ---------------------------------------------------------------------------
def _fmt(d):
    d = db.parse_date(d) if isinstance(d, str) else d
    return d.strftime("%d/%m/%Y") if d else ""


def _person(s, kind, pid, snap_name):
    """الاسم بالإنجليزي والمهنة والإقامة من السجل الحالي (والاسم وقت الطلب لو اتمسح)."""
    rec = s.get(M.Employee, pid) if kind == "employee" else s.get(M.Candidate, pid)
    return {"name": (rec.nameEn if rec is not None and rec.nameEn else None) or snap_name or pid,
            "nameAr": rec.name if rec is not None else snap_name, "profession": rec.profession if rec is not None else "",
            "residencyExp": getattr(rec, "residencyExp", None) if rec is not None else None}


def _cost_center(s, name, fallback_company):
    """مركز التكلفة ← (اسمه بالإنجليزي والعربي، شركته) — الشركة للشعار والاسم في رأس الكشف."""
    cc = s.scalar(select(M.CostCenter).where(M.CostCenter.name == name)) if name else None
    co_id = (cc.companyId if cc is not None else None) or fallback_company
    label = " — ".join(x for x in ((cc.nameEn if cc is not None else None), name) if x) or "بدون مركز تكلفة / No cost center"
    return label, (s.get(M.Company, co_id) if co_id else None)


def _items(lines):
    cols = []
    for ln in sorted(lines, key=lambda x: x.position):
        key = ln.feeItemId or ln.itemName
        if key not in [c["key"] for c in cols]:
            cols.append({"key": key, "en": ln.itemNameEn or ln.itemName, "ar": ln.itemName})
    return cols


def _group_people(s, lines):
    """البنود ← [(مركز التكلفة، [أشخاص])] — الشخص: بياناته وبنوده."""
    people = {}
    for ln in lines:
        k = (ln.personKind, ln.personId)
        if k not in people:
            people[k] = {**_person(s, ln.personKind, ln.personId, ln.personName), "civilId": ln.civilId or "",
                         "costCenter": ln.costCenter, "companyId": ln.companyId, "lines": []}
        people[k]["lines"].append(ln)
    groups = {}
    for p in people.values():
        groups.setdefault(p["costCenter"] or "", []).append(p)
    return sorted(((cc, sorted(ps, key=lambda p: p["name"].lower())) for cc, ps in groups.items()), key=lambda g: g[0])


def _amount(ln, actual=True):
    return float((ln.actual if actual and ln.actual is not None else ln.planned) or 0)


# ---------------------------------------------------------------------------
# كشف تقفيل العهدة
# ---------------------------------------------------------------------------
def _closing_group_sheet(ws, c, cc_label, company, people, items, admin_fee, when, user):
    headers = ["#", "Employee Name\nاسم الموظف", "Profession\nالمهنة", "Civil ID\nالرقم المدني"] \
        + [f"{it['en']}\n{it['ar']}" for it in items] + ["Admin Support\nالدعم الإداري", "Total (KWD)\nالإجمالي (د.ك)"]
    n = len(headers)
    _widths(ws, [5, 34, 22, 15] + [15] * len(items) + [14, 15])
    row = _header(ws, n, company, "CUSTODY CLOSING STATEMENT", "كشف تقفيل عهدة")
    tx = custody.TX_TYPES.get(c.txType, {})
    row, box = _info(ws, row, n, [
        ("Cost Center / مركز التكلفة", cc_label),
        ("Request For / نوع المعاملة", f"{tx.get('en', c.txType)} — {tx.get('label', '')}"),
        ("Custody No. / رقم العهدة", f"CUS-{c.no:04d}"),
        ("Custodian / المستلم", c.custodian),
        ("Closing Date / تاريخ التقفيل", _fmt(when)),
    ], "TOTAL DUE (KWD) / إجمالي المستحق", f"{len(people)} Employees · موظف")
    head = row
    _table_head(ws, head, headers)
    first = head + 1
    for i, p in enumerate(people):
        by = {ln.feeItemId or ln.itemName: ln for ln in p["lines"]}
        r = first + i
        amounts = [(_amount(by[it["key"]]) if it["key"] in by else "—") for it in items]
        _table_row(ws, r, [i + 1, p["name"], p["profession"], p["civilId"], *amounts, admin_fee,
                           f"=SUM({get_column_letter(5)}{r}:{get_column_letter(n - 1)}{r})"], money_from=5, zebra=i % 2 == 1)
    last = first + len(people) - 1
    tot = last + 1
    box.value = "=" + _total_row(ws, tot, n, f"TOTAL / الإجمالي  ({len(people)})", first, last, 5, 4)
    grand = sum(_amount(ln) for p in people for ln in p["lines"]) + admin_fee * len(people)
    row = _words_row(ws, tot + 2, n, grand)
    row = _note(ws, row + 1, n)
    _signatures(ws, row, n, ["Prepared By / أعده", "Reviewed By / راجعه", "Manager Approval / اعتماد المدير",
                             "Finance / الإدارة المالية"], user)
    ws.freeze_panes = ws.cell(row=first, column=3)
    _print_setup(ws, n > 7, head, f"CUS-{c.no:04d} · {cc_label}")
    _fit(ws, n > 7, head, tot + 2)
    return grand


def _closing_individual(ws, row, c, cc_label, company, p, items, admin_fee, when, user, first_page):
    """كشف فردي لموظف (نموذج T-104) — بيبدأ من row، وكل كشف في صفحة مطبوعة لوحده."""
    n = 6
    if first_page:
        _widths(ws, [5, 46, 28, 16, 16, 20])
    start = row
    row = _header(ws, n, company, "CUSTODY CLOSING STATEMENT", "كشف تقفيل عهدة") if first_page else _header_at(ws, row, n, company)
    tx = custody.TX_TYPES.get(c.txType, {})
    lines = sorted(p["lines"], key=lambda x: x.position)
    row, box = _info(ws, row, n, [
        ("Employee Name / اسم الموظف", f"{p['name']}" + (f"  —  {p['nameAr']}" if p["nameAr"] and p["nameAr"] != p["name"] else "")),
        ("Profession / المهنة", p["profession"]),
        ("Civil ID / الرقم المدني", p["civilId"]),
        ("Cost Center / مركز التكلفة", cc_label),
        ("Request For / نوع المعاملة", f"{tx.get('en', c.txType)} — {tx.get('label', '')}"),
        ("Custody No. / رقم العهدة", f"CUS-{c.no:04d}"),
        ("Closing Date / تاريخ التقفيل", _fmt(when)),
    ], "TOTAL (KWD) / الإجمالي", "Kuwaiti Dinar · دينار كويتي")
    head = row
    _table_head(ws, head, ["#", "Process\nالإجراء", "Authority\nالجهة", "Charges (KWD)\nالمبلغ (د.ك)", "Receipt No.\nرقم الإيصال",
                           "Notes\nملاحظات"])
    for i, ln in enumerate(lines):
        _table_row(ws, head + 1 + i, [i + 1, f"{ln.itemNameEn or ln.itemName}  —  {ln.itemName}", ln.authority or "", _amount(ln),
                                      ln.receiptNo or "", ""], money_from=4, zebra=i % 2 == 1, left_cols=(2, 3))
    r = head + 1 + len(lines)
    _table_row(ws, r, [len(lines) + 1, "Administrative Support  —  الدعم الإداري", "Admin Unit · الشؤون الإدارية", admin_fee, "", ""],
               money_from=4, zebra=len(lines) % 2 == 1, left_cols=(2, 3))
    for cc in (5, 6):                                     # مابيتجمعوش
        ws.cell(row=r, column=cc).number_format = "General"
    tot = r + 1
    top = Border(left=_side(), right=_side(), top=_side(PRIMARY, "medium"), bottom=_side(PRIMARY, "double"))
    ws.row_dimensions[tot].height = 24
    _put(ws, tot, 1, "TOTAL / الإجمالي", to_col=3, bold=True, color=PRIMARY, fill=PRIMARY_SOFT, h="left", border=top)
    _put(ws, tot, 4, f"=SUM(D{head + 1}:D{r})", bold=True, color=PRIMARY, fill=PRIMARY_SOFT, fmt=KWD, border=top)
    box.value = f"=D{tot}"
    _put(ws, tot, 5, None, to_col=6, fill=PRIMARY_SOFT, border=top)
    grand = sum(_amount(ln) for ln in lines) + admin_fee
    row = _words_row(ws, tot + 2, n, grand)
    row = _note(ws, row + 1, n)
    row = _signatures(ws, row, n, ["Prepared By / أعده", "Manager Approval / اعتماد المدير", "Finance / الإدارة المالية"], user)
    return row + 1, head, grand


def _header_at(ws, row, n, company):
    """رأس كشف فردي تاني في نفس الشيت (بعد فاصل صفحة): نفس الرأس من غير الشعار."""
    ws.row_dimensions[row].height = 24
    name_en = company.nameEn if company is not None else ""
    _put(ws, row, 1, name_en, to_col=3, bold=True, size=12, color=PRIMARY, h="left")
    _put(ws, row, 4, "CUSTODY CLOSING STATEMENT · كشف تقفيل عهدة", to_col=n, bold=True, size=11, color=PRIMARY, h="right")
    _put(ws, row + 1, 1, company.nameAr if company is not None else "", to_col=3, size=10, h="left")
    _put(ws, row + 1, 4, FORM_NO, to_col=n, size=9, color=MUTED, h="right")
    for c in range(1, n + 1):
        ws.cell(row=row + 2, column=c).fill = _fill(ACCENT)
    ws.row_dimensions[row + 2].height = 4
    return row + 4


def closing_workbook(s, c, lines, admin_fee, when, user, individual=False):
    """كشف تقفيل: «الملخص» + شيت لكل مركز تكلفة. lines = بنود الأشخاص اللي اتقفلوا في الكشف ده."""
    from openpyxl.worksheet.pagebreak import Break
    wb = Workbook()
    summary = wb.active
    items = _items(lines)
    groups = _group_people(s, lines)
    rows = []
    for cc, people in groups:
        label, company = _cost_center(s, cc, people[0]["companyId"] or c.companyId)
        ws = wb.create_sheet(_sheet_name(wb, cc or "بدون مركز تكلفة"))
        if individual or len(people) == 1:
            r, total, heads = 1, 0, []
            for i, p in enumerate(people):
                if i:
                    ws.row_breaks.append(Break(id=r - 1))
                r, head, g = _closing_individual(ws, r, c, label, company, p, items, admin_fee, when, user, i == 0)
                total += g
                heads.append(head)
            _print_setup(ws, False, None, f"CUS-{c.no:04d} · {label}")
        else:
            total = _closing_group_sheet(ws, c, label, company, people, items, admin_fee, when, user)
        gov = sum(_amount(ln) for p in people for ln in p["lines"])
        rows.append((label, company, len(people), gov, admin_fee * len(people), ws.title))
    _closing_summary(summary, s, c, rows, admin_fee, when, user)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _closing_summary(ws, s, c, rows, admin_fee, when, user):
    ws.title = "الملخص Summary"
    headers = ["#", "Cost Center\nمركز التكلفة", "Company\nالشركة", "Employees\nعدد الموظفين",
               "Government Charges\nالرسوم الحكومية", "Admin Support\nالدعم الإداري", "Total (KWD)\nالإجمالي (د.ك)"]
    n = len(headers)
    _widths(ws, [5, 32, 40, 13, 18, 16, 17])
    weight = {}
    for r in rows:
        if r[1] is not None:
            weight[r[1]] = weight.get(r[1], 0) + r[2]
    head_company = (s.get(M.Company, c.companyId) if c.companyId else None) or (max(weight, key=weight.get) if weight else None)
    row = _header(ws, n, head_company, "CUSTODY CLOSING SUMMARY", "ملخص تقفيل العهدة")
    tx = custody.TX_TYPES.get(c.txType, {})
    row, box = _info(ws, row, n, [
        ("Custody No. / رقم العهدة", f"CUS-{c.no:04d}"),
        ("Request For / نوع المعاملة", f"{tx.get('en', c.txType)} — {tx.get('label', '')}"),
        ("Custodian / المستلم", c.custodian),
        ("Disbursed / تاريخ الصرف", f"{_fmt(c.disbursedDate)}   ·   {c.disbursedAmount or 0:,.3f} KWD"),
        ("Closing Date / تاريخ التقفيل", _fmt(when)),
    ], "TOTAL DUE (KWD) / إجمالي المستحق", f"Admin support {admin_fee:g} KWD / employee")
    head = row
    _table_head(ws, head, headers)
    for i, (label, company, count, gov, adm, sheet) in enumerate(rows):
        r = head + 1 + i
        _table_row(ws, r, [i + 1, label, company.nameEn if company is not None else "", count, gov, adm, f"=E{r}+F{r}"],
                   money_from=5, zebra=i % 2 == 1, left_cols=(2, 3))
        ws.cell(row=r, column=2).hyperlink = f"#'{sheet}'!A1"
        ws.cell(row=r, column=2).font = Font(name=FONT, size=10, color=PRIMARY, underline="single")
    last = head + len(rows)
    tot = last + 1
    box.value = "=" + _total_row(ws, tot, n, f"TOTAL / الإجمالي  ({len(rows)})", head + 1, last, 4, 3)
    ws.cell(row=tot, column=4).number_format = "0"
    # تسوية العهدة مع المستلم (العهدة كلها، مش الكشف ده بس)
    lines = s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == c.id)).all()
    spent = sum(_amount(ln) for ln in lines if ln.done)
    got = float(c.disbursedAmount or 0)
    r = tot + 2
    _put(ws, r, 1, "CUSTODY SETTLEMENT · تسوية العهدة مع المستلم", to_col=n, bold=True, size=10, color="FFFFFF", fill=PRIMARY, h="left")
    for i, (label, val, col) in enumerate((("Amount disbursed to custodian / المصروف للمستلم", got, INK),
                                           ("Government charges executed (whole custody) / المنفّذ من العهدة", spent, INK),
                                           ("Balance with custodian / الرصيد مع المستلم" if got >= spent
                                            else "Due to custodian / مستحق للمستلم", got - spent, PRIMARY if got >= spent else RED))):
        _put(ws, r + 1 + i, 1, label, to_col=5, size=10, h="left", border=GRID, bold=i == 2)
        _put(ws, r + 1 + i, 6, abs(val) if i == 2 else val, to_col=7, size=10, bold=i == 2, color=col, fmt=KWD, border=GRID)
    row = _note(ws, r + 5, n)
    _signatures(ws, row, n, ["Prepared By / أعده", "Reviewed By / راجعه", "Manager Approval / اعتماد المدير",
                             "Finance / الإدارة المالية"], user)
    _print_setup(ws, False, head, f"CUS-{c.no:04d} · {c.custodian}")
    _fit(ws, False, head, r)


# ---------------------------------------------------------------------------
# طلب صرف العهدة
# ---------------------------------------------------------------------------
def request_workbook(s, c, user):
    lines = s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == c.id)).all()
    items = _items(lines)
    groups = _group_people(s, lines)
    people = [(cc, p) for cc, ps in groups for p in ps]
    employees = custody.TX_TYPES.get(c.txType, {}).get("kind") == "employee"
    wb = Workbook()
    ws = wb.active
    ws.title = "طلب الصرف Request"
    headers = ["#", "Employee Name\nاسم الموظف", "Profession\nالمهنة", "Civil ID\nالرقم المدني", "Cost Center\nمركز التكلفة"] \
        + (["Residency Expiry\nانتهاء الإقامة", "Days Left\nالمتبقي"] if employees else []) \
        + [f"{it['en']}\n{it['ar']}" for it in items] + ["Total (KWD)\nالإجمالي (د.ك)"]
    n = len(headers)
    money_from = 8 if employees else 6
    _widths(ws, [5, 32, 22, 15, 22] + ([14, 10] if employees else []) + [14] * len(items) + [15])
    companies = {p["companyId"] for _, p in people if p["companyId"]}
    company = (s.get(M.Company, c.companyId) if c.companyId else None) or (s.get(M.Company, companies.pop()) if len(companies) == 1 else None)
    row = _header(ws, n, company, "ADVANCE PAYMENT REQUEST", "طلب صرف عهدة")
    tx = custody.TX_TYPES.get(c.txType, {})
    row, box = _info(ws, row, n, [
        ("Custody No. / رقم العهدة", f"CUS-{c.no:04d}"),
        ("Request For / نوع المعاملة", f"{tx.get('en', c.txType)} — {tx.get('label', '')}"),
        ("Custodian / المستلم", c.custodian),
        ("Request Date / تاريخ الطلب", _fmt(c.requestDate)),
        ("Notes / ملاحظات", c.notes or ""),
    ], "AMOUNT REQUIRED (KWD) / المبلغ المطلوب", f"{len(people)} Employees · موظف")
    head = row
    _table_head(ws, head, headers)
    today = date.today()
    for i, (cc, p) in enumerate(people):
        r = head + 1 + i
        by = {ln.feeItemId or ln.itemName: ln for ln in p["lines"]}
        exp = p["residencyExp"]
        extra = [_fmt(exp), (exp - today).days if exp else ""] if employees else []
        amounts = [(_amount(by[it["key"]], actual=False) if it["key"] in by else "—") for it in items]
        cc_en = s.scalar(select(M.CostCenter.nameEn).where(M.CostCenter.name == cc)) if cc else None
        _table_row(ws, r, [i + 1, p["name"], p["profession"], p["civilId"], cc_en or cc or "—", *extra, *amounts,
                           f"=SUM({get_column_letter(money_from)}{r}:{get_column_letter(n - 1)}{r})"],
                   money_from=money_from, zebra=i % 2 == 1, left_cols=(2,))
        if employees and exp and (exp - today).days < 0:
            ws.cell(row=r, column=7).font = Font(name=FONT, size=10, bold=True, color=RED)
    last = head + len(people)
    tot = last + 1
    box.value = "=" + _total_row(ws, tot, n, f"GRAND TOTAL / الإجمالي العام  ({len(people)})", head + 1, last, money_from,
                                  money_from - 1)
    # ملخص المطلوب لكل مركز تكلفة
    r = tot + 2
    _put(ws, r, 1, "SUMMARY PER COST CENTER · ملخص المطلوب لكل مركز تكلفة", to_col=n, bold=True, size=10, color="FFFFFF",
         fill=PRIMARY, h="left")
    for i, (cc, ps) in enumerate(groups):
        label, co = _cost_center(s, cc, ps[0]["companyId"])
        amt = sum(_amount(ln, actual=False) for p in ps for ln in p["lines"])
        _put(ws, r + 1 + i, 1, i + 1, size=10, color=MUTED, border=GRID, fill=ZEBRA if i % 2 else None)
        _put(ws, r + 1 + i, 2, label, to_col=4, size=10, h="left", border=GRID, fill=ZEBRA if i % 2 else None)
        _put(ws, r + 1 + i, 5, f"{len(ps)} Employees · موظف", to_col=max(5, n - 1), size=10, border=GRID, fill=ZEBRA if i % 2 else None)
        _put(ws, r + 1 + i, n, amt, size=10, fmt=KWD, border=GRID, fill=ZEBRA if i % 2 else None)
    row = _words_row(ws, r + 2 + len(groups), n, sum(_amount(ln, actual=False) for ln in lines))
    row = _note(ws, row + 1, n)
    _signatures(ws, row, n, ["Custodian / المستلم", "Manager / المسؤول", "Finance / الإدارة المالية"], None)
    ws.freeze_panes = ws.cell(row=head + 1, column=3)
    _print_setup(ws, n > 8, head, f"CUS-{c.no:04d} · {c.custodian}")
    _fit(ws, n > 8, head, r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
