# -*- coding: utf-8 -*-
"""
الاستيراد التكميلي (📥 لمدير النظام) — القسم 27
ملف Excel / CSV ← **بيملى الخانات الفاضية بس**، ومابيكتبش فوق أي قيمة موجودة (المختلف بيطلع في قايمة مراجعة).
- الموظفين: المطابقة بالرقم المدني أو الرقم الوظيفي أو الاسم. الأسماء اللي مش متطابقة بالظبط ← أقرب الأسماء
  في السيستم كاقتراحات، ومدير النظام بيأكد أو بيرفض (مفيش حاجة بتتربط لوحدها).
- الأعمدة المسموحة بس (EMP_FIELDS)، ومدير النظام بيختار منها اللي يتاخد.
- كل دفعة بتتسجّل (import_batches / import_changes) بالقيمة القديمة والجديدة ← «↩️ تراجع» بيرجّع القديم للخانات اللي
  ماتغيّرتش بعد الاستيراد.
"""
import csv
import json
import os
import re
from datetime import date, datetime

import openpyxl
from sqlalchemy import select

import db
import importer
import models as M

# الخانة ← (الاسم، النوع، كلمات في عنوان العمود بتقترحها لوحدها)
EMP_FIELDS = {
    "dpId": ("الرقم الوظيفي", "text", ("رمز الموظف", "الرقم الوظيفي")),
    "qualification": ("المؤهل الدراسي", "text", ("degree", "الدرجة", "المؤهل")),
    "specialization": ("التخصص", "text", ("major", "التخصص")),
    "university": ("الجامعة / جهة التخرج", "text", ("الجامعة", "university")),
    "unifiedNumber": ("الرقم الموحد", "digits", ("الرقم الموحد",)),
    "dateOfHire": ("تاريخ التعيين", "date", ("تاريخ التعين", "تاريخ التعيين")),
    "kuwaitEntryDate": ("تاريخ دخول الكويت", "date", ("تاريخ الدخول", "دخول الكويت")),
    "phone": ("الهاتف", "phone", ("mobile", "الهاتف", "موبايل", "تليفون")),
    "email": ("البريد الإلكتروني", "email", ("email", "الإيميل", "البريد")),
}
# المطابقة ← كلمات في عنوان العمود
MATCH_BY = {"civil": ("الرقم المدني", ("civil id", "civilid", "الرقم المدني", "رقم مدني")),
            "code": ("الرقم الوظيفي", ("رمز الموظف", "الرقم الوظيفي")),
            "name": ("الاسم", ("الاسم الكامل", "الاسم", "name (arabic)", "name"))}
MAX_LIST = 1500


# ---------------------------------------------------------------------------
# قراءة الملف
# ---------------------------------------------------------------------------
def read_book(path):
    """{اسم الشيت: [صفوف]} — xlsx بالقيم (مش المعادلات)، xls بالـ pandas، csv."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        with open(path, encoding="utf-8-sig", newline="") as f:
            return {"CSV": [tuple(r) for r in csv.reader(f)]}
    if ext == ".xls":
        import pandas as pd
        book = pd.read_excel(path, sheet_name=None, header=None)
        return {str(n): [tuple(None if pd.isna(x) else x for x in r) for r in df.itertuples(index=False)] for n, df in book.items()}
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        out = {}
        for ws in wb.worksheets:
            rows = [tuple(r) for r in ws.iter_rows(values_only=True)]
            while rows and all(v in (None, "") for v in rows[-1]):
                rows.pop()
            width = max((max((i + 1 for i, v in enumerate(r) if v not in (None, "")), default=0) for r in rows), default=0)
            out[ws.title] = [tuple(r[:width]) + (None,) * (width - len(r[:width])) for r in rows]
        return out
    finally:
        wb.close()


def cell_text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    return "" if s.lower() in ("nan", "none", "nat") else s


def header_row(rows):
    """صف العناوين = الصف اللي فيه أكتر نصوص (مش أرقام) في أول 15 صف."""
    best, score = 0, -1
    for i, r in enumerate(rows[:15]):
        n = sum(1 for v in r if isinstance(v, str) and v.strip() and not re.fullmatch(r"[\d\s.\-/:]+", v.strip()))
        if n > score:
            best, score = i, n
    return best


def col_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _hnorm(h):
    return re.sub(r"\s+", " ", cell_text(h)).strip().lower()


def suggest(headers):
    """(عمود المطابقة، نوعها، {العمود: الخانة}) من عناوين الأعمدة. الرقم المدني الأول، وبعده الاسم (الرقم الوظيفي
    غالبًا هو اللي هيتملى، زي ملف سكومي — المطابقة بيه بتتختار يدويًا)."""
    match_col, match_by = None, None
    for by in ("civil", "name"):
        for i, h in enumerate(headers):
            if any(k in _hnorm(h) for k in MATCH_BY[by][1]):
                match_col, match_by = i, by
                break
        if match_col is not None:
            break
    mapping, used = {}, set()
    for i, h in enumerate(headers):
        if i == match_col:
            continue
        hn = _hnorm(h)
        for f, (_, _, keys) in EMP_FIELDS.items():
            if f not in used and any(k in hn for k in keys):
                mapping[i] = f
                used.add(f)
                break
    return match_col, match_by, mapping


def describe(path):
    """الشيتات ← عناوينها وعدد صفوفها وعينة، واقتراح المطابقة والأعمدة."""
    out = []
    for name, rows in read_book(path).items():
        h = header_row(rows)
        headers = [cell_text(x) for x in (rows[h] if rows else ())]
        mc, mb, mp = suggest(headers)
        out.append({"name": name, "headerRow": h, "rows": max(len(rows) - h - 1, 0), "total": len(rows),
                    "top": [[cell_text(v) for v in r] for r in rows[:20]],      # لو صف العناوين اتغيّر من الشاشة
                    "columns": [{"i": i, "letter": col_letter(i), "title": x} for i, x in enumerate(headers)],
                    "matchCol": mc, "matchBy": mb, "map": {str(k): v for k, v in mp.items()}})
    return out


# ---------------------------------------------------------------------------
# القيم
# ---------------------------------------------------------------------------
def parse_value(kind, v):
    """قيمة الملف ← (القيمة، None) أو (None، سبب الرفض) أو (None، None) لو فاضية."""
    s = cell_text(v)
    if not s or s in ("-", "—", "_", "0"):
        return None, None
    if kind == "date":
        d = importer.norm_date(v if isinstance(v, (datetime, date)) else s)
        if not d or not ("1950" <= d[:4] <= "2100"):
            return None, "تاريخ مش مفهوم"
        return d, None
    if kind == "digits":
        n = re.sub(r"\D", "", s)
        return (n, None) if n else (None, "لازم أرقام")
    if kind == "phone":
        n = re.sub(r"\D", "", s)
        if n.startswith("965") and len(n) == 11:
            n = n[3:]
        return (n, None) if len(n) >= 7 else (None, "رقم تليفون ناقص")
    if kind == "email":
        e = s.lower()
        return (e, None) if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e) else (None, "إيميل مش صحيح")
    return re.sub(r"\s+", " ", s)[:300], None


def _same(kind, a, b):
    if kind in ("digits", "phone"):
        return re.sub(r"\D", "", a or "") == re.sub(r"\D", "", b or "")
    if kind == "text":
        return norm_name(a) == norm_name(b)
    return (a or "").strip().lower() == (b or "").strip().lower()


def current(e, field):
    v = getattr(e, field)
    return db.ser(v) if isinstance(v, (date, datetime)) else ("" if v is None else str(v).strip())


def norm_name(s):
    """مطابقة الأسماء: من غير تشكيل ولا نقط، والألف والتاء المربوطة والياء موحّدين، و«عبد ال…» كلمة واحدة."""
    s = re.sub(r"[ً-ْـ]", "", str(s or ""))
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي")):
        s = s.replace(a, b)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\bعبد\s+ال", "عبدال", s)
    s = re.sub(r"\bابو\s+", "ابو", s)
    return " ".join(s.lower().split())


def name_score(a, b):
    ta, tb = a.split(), b.split()
    if not ta or not tb:
        return 0.0
    score = len(set(ta) & set(tb)) / max(len(ta), len(tb))
    if ta[0] == tb[0]:
        score += 0.15
    return round(min(score, 1.0), 2)


# ---------------------------------------------------------------------------
# المعاينة والتنفيذ
# ---------------------------------------------------------------------------
def analyze(s, rows, header, match_col, match_by, mapping, confirm=None):
    """الخطة: لكل موظف اتطابق ← الخانات (هتتملى / زي ما هي / مختلفة)، ومعاها اللي ماتلقاش والاقتراحات.
    confirm = {رقم الصف: الرقم المدني} ← أسماء اتأكدت من الاقتراحات ("" = مش موجود)."""
    if match_by not in MATCH_BY:
        raise ValueError("اختار طريقة المطابقة")
    mapping = {int(k): f for k, f in (mapping or {}).items() if f in EMP_FIELDS}
    if not mapping:
        raise ValueError("اختار عمود واحد على الأقل يتاخد")
    confirm = {int(k): v for k, v in (confirm or {}).items()}
    emps = list(s.scalars(select(M.Employee)))
    by_id = {e.id: e for e in emps}
    by_code, by_name = {}, {}
    for e in emps:
        if e.dpId:
            by_code.setdefault(str(e.dpId).strip(), e)
        by_name.setdefault(norm_name(e.name), []).append(e)
    names = [(norm_name(e.name), e) for e in emps]
    plan, seen = {}, {}
    res = {"fills": [], "conflicts": [], "invalid": [], "notFound": [], "suggest": [], "dupRows": 0, "matched": 0, "confirmed": 0,
           "fields": {f: {"label": EMP_FIELDS[f][0], "fill": 0, "same": 0, "conflict": 0, "invalid": 0} for f in mapping.values()}}
    data_rows = rows[header + 1:]
    for n, r in enumerate(data_rows):
        rowno = header + 2 + n                                  # رقم الصف في Excel
        key = cell_text(r[match_col]) if match_col is not None and match_col < len(r) else ""
        vals = {c: parse_value(EMP_FIELDS[f][1], r[c] if c < len(r) else None) for c, f in mapping.items()}
        if not key or not any(v or bad for v, bad in vals.values()):
            continue                                            # صف فاضي أو مالوش قيم في الأعمدة المختارة
        e = None
        if rowno in confirm:
            e = by_id.get(confirm[rowno]) if confirm[rowno] else None
            if e is None:
                continue                                        # «مش موجود» ← بيتجاهل
            res["confirmed"] += 1
        elif match_by == "civil":
            e = by_id.get(re.sub(r"\D", "", key))
        elif match_by == "code":
            e = by_code.get(key)
        else:
            hits = by_name.get(norm_name(key), [])
            if len(hits) == 1:
                e = hits[0]
            else:
                nk = norm_name(key)
                cands = sorted(((name_score(nk, nn), x) for nn, x in names), key=lambda t: -t[0])
                cands = [{"id": x.id, "name": x.name, "score": sc, "costCenter": x.costCenter or ""} for sc, x in cands[:3] if sc >= 0.45]
                res["suggest"].append({"row": rowno, "key": key, "same": len(hits), "candidates": cands})
                continue
        if e is None:
            res["notFound"].append({"row": rowno, "key": key})
            continue
        if e.id in seen:
            res["dupRows"] += 1
        rec = plan.setdefault(e.id, {"emp": e, "row": rowno, "fields": {}})
        seen[e.id] = True
        for c, f in mapping.items():
            kind = EMP_FIELDS[f][1]
            val, bad = vals[c]
            if bad:
                res["fields"][f]["invalid"] += 1
                if len(res["invalid"]) < MAX_LIST:
                    res["invalid"].append({"row": rowno, "id": e.id, "name": e.name, "field": f, "value": cell_text(r[c]), "reason": bad})
                continue
            if val is None or f in rec["fields"]:
                continue                                        # فاضية، أو الموظف اتكرر في الملف ← أول قيمة بس
            cur = current(e, f)
            st = "fill" if not cur else "same" if _same(kind, cur, val) else "conflict"
            rec["fields"][f] = (st, val, cur)
            res["fields"][f][st] += 1
            if st == "fill" and len(res["fills"]) < MAX_LIST:
                res["fills"].append({"row": rowno, "id": e.id, "name": e.name, "field": f, "value": val})
            elif st == "conflict" and len(res["conflicts"]) < MAX_LIST:
                res["conflicts"].append({"row": rowno, "id": e.id, "name": e.name, "field": f, "current": cur, "file": val})
    res["matched"] = len(plan)
    res["fillTotal"] = sum(x["fill"] for x in res["fields"].values())
    res["employeesToFill"] = sum(1 for rec in plan.values() if any(st == "fill" for st, _, _ in rec["fields"].values()))
    return plan, res


def apply_plan(s, plan, file_name, sheet, user, res):
    """الخانات الفاضية بس ← دفعة استيراد متسجّلة (القديم والجديد) + سجل الموظف."""
    batch = M.ImportBatch(id=db.new_id("ib"), target="employees", fileName=file_name, sheet=sheet, createdBy=user, createdAt=db.now())
    s.add(batch)
    s.flush()
    touched = 0
    for rec in plan.values():
        e, done = rec["emp"], []
        for f, (st, val, cur) in rec["fields"].items():
            if st != "fill":
                continue
            db.apply(e, {f: val})
            s.add(M.ImportChange(batchId=batch.id, entity="employee", recordId=e.id, field=f, oldValue=cur or None, newValue=val))
            done.append(EMP_FIELDS[f][0])
        if done:
            touched += 1
            e.lastUpdated, e.lastUpdatedBy = db.now(), user
            db.push_timeline(s, e.id, "import_update", f"استيراد تكميلي ({file_name}): " + "، ".join(done), user)
    summary = {"employees": touched, "values": res["fillTotal"], "conflicts": sum(x["conflict"] for x in res["fields"].values()),
               "notFound": len(res["notFound"]), "confirmed": res["confirmed"],
               "fields": {f: x["fill"] for f, x in res["fields"].items() if x["fill"]}}
    batch.summary = json.dumps(summary, ensure_ascii=False)
    return batch, summary


def undo_batch(s, batch, user):
    """بيرجّع القيمة القديمة لكل خانة لسه زي ما الاستيراد سابها (اللي اتعدّلت بعده بتفضل)."""
    restored, kept, per_emp = 0, [], {}
    for ch in s.scalars(select(M.ImportChange).where(M.ImportChange.batchId == batch.id)):
        if ch.entity != "employee":
            continue
        e = s.get(M.Employee, ch.recordId)
        if e is None:
            continue
        kind = EMP_FIELDS.get(ch.field, ("", "text"))[1]
        if not _same(kind, current(e, ch.field), ch.newValue):
            kept.append({"id": e.id, "name": e.name, "field": ch.field, "label": EMP_FIELDS.get(ch.field, (ch.field,))[0]})
            continue
        db.apply(e, {ch.field: ch.oldValue})
        restored += 1
        per_emp.setdefault(e.id, []).append(EMP_FIELDS.get(ch.field, (ch.field,))[0])
    for eid, labels in per_emp.items():
        e = s.get(M.Employee, eid)
        e.lastUpdated, e.lastUpdatedBy = db.now(), user
        db.push_timeline(s, eid, "import_update", f"تراجع عن استيراد تكميلي ({batch.fileName}): " + "، ".join(labels), user)
    batch.undoneAt, batch.undoneBy = db.now(), user
    return restored, kept


def batch_api(b, counts):
    try:
        summary = json.loads(b.summary or "{}")
    except ValueError:
        summary = {}
    return {"id": b.id, "target": b.target, "fileName": b.fileName, "sheet": b.sheet, "summary": summary,
            "changes": counts.get(b.id, 0), "createdBy": b.createdBy, "createdAt": db.ser(b.createdAt),
            "undoneBy": b.undoneBy, "undoneAt": db.ser(b.undoneAt)}
