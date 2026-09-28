# -*- coding: utf-8 -*-
"""
Lunx — العهد والمصروفات.

العهدة = مبلغ بيتصرف لمستلم (مندوب — أي اسم) علشان يدفع رسوم معاملات مجموعة موظفين أو مترشّحين:
  طلب (بيتطبع ويتعتمد على الورق) ← «تم الصرف» (المبلغ وتاريخه) ← تنفيذ البنود ← تقفيل (المرحلة التانية).
- بنودها من جدول الرسوم (fee_items) حسب نوع الطلب، ولكل شخص نسخة من البند والمبلغ ومركز التكلفة وقت الطلب.
- البند مربوط بمرحلة: لما مرحلة الشخص (المعاملة الحكومية للموظف أو «تسجيل موظف جديد» للمترشّح) تعدّي مرحلة
  البند، بيتعلّم «تم» لوحده (sync_person) والمبلغ الفعلي = المحدد لحد ما يتعدّل.
- الرصيد مع المستلم = المصروف له − المنفّذ فعلًا (البنود اللي «تم»).
"""
from datetime import date

from sqlalchemy import func, select

import db
import models as M

# أنواع الطلب: على مين (موظف / مترشّح) ومراحل مين
TX_TYPES = {
    "renewal": {"label": "تجديد إقامة", "en": "Residency Renewal", "kind": "employee", "flow": "gov"},
    "transfer_in": {"label": "تحويل إقامة من الداخل", "en": "Residency Transfer (within the group)", "kind": "employee",
                    "flow": "gov"},
    "transfer_out": {"label": "تحويل إقامة من الخارج", "en": "Residency Transfer (from another sponsor)", "kind": "candidate",
                     "flow": "internal"},
    "visa": {"label": "إصدار تأشيرة عمل", "en": "Work Visa Issuance", "kind": "candidate", "flow": "outside"},
    "first_residency": {"label": "إصدار إقامة أول مرة", "en": "First Residency Issuance", "kind": "candidate", "flow": "outside"},
}
DEFAULT_ADMIN_FEE = 20            # الدعم الإداري لكل شخص في كشف التقفيل (بيتعدّل وقت التقفيل)
# ترتيب المراحل (نفس GOV_STAGES و RECRUIT_STAGES_* في static/js/core.js — لو اتغيّروا هناك يتغيّروا هنا).
# المرحلة = الخطوة الشغالة دلوقتي، فالبند «تم» لما الشخص يوصل مرحلة بعد مرحلته أو آخر مرحلة.
FLOWS = {
    "gov": ("awaiting_contract", "awaiting_work_permit", "health_insurance", "residency", "civil_id", "renewed"),
    "outside": ("work_permit", "work_visa", "medical_exam", "foreign_ministry_auth", "employment_contract", "work_license",
                "health_insurance", "residency_issue", "civil_id_issue", "all_completed"),
    "internal": ("employment_contract", "sponsor_approval", "transfer_work_license", "health_insurance_internal",
                 "residency_issue_internal", "civil_id_renew", "all_completed"),
}
STATUSES = {"requested": "مطلوبة", "disbursed": "تم الصرف", "closed": "مقفولة", "cancelled": "ملغاة"}
OPEN = ("requested", "disbursed")


def num(v):
    try:
        return round(float(v), 3) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def stage_passed(flow, current, item_stage):
    order = FLOWS.get(flow, ())
    if current not in order or item_stage not in order:
        return False
    return current == order[-1] or order.index(current) > order.index(item_stage)


def sync_person(s, kind, pid, stage):
    """مرحلة الشخص اتغيّرت ← بنوده اللي المرحلة عدّتها في العهد المفتوحة تتعلّم «تم».
    مابيرجّعش بند «تم» لو المرحلة رجعت لورا (ده بيتعدّل يدوي من العهدة). بيرجّع عدد البنود."""
    if not stage or not pid:
        return 0
    rows = s.execute(select(M.CustodyLine, M.Custody.txType).join(M.Custody, M.Custody.id == M.CustodyLine.custodyId)
                     .where(M.CustodyLine.personKind == kind, M.CustodyLine.personId == pid,
                            M.CustodyLine.done.is_(False), M.Custody.status.in_(OPEN))).all()
    n = 0
    for line, tx in rows:
        if stage_passed(TX_TYPES.get(tx, {}).get("flow"), stage, line.stage):
            line.done, line.doneDate = True, date.today()
            if line.actual is None:
                line.actual = line.planned
            n += 1
    return n


def candidate_to_employee(s, cand_id, civil):
    """المترشّح اتحوّل لموظف (خلّص كل المراحل): بنوده المفتوحة «تم»، وبنود كل عهده بقت على الموظف."""
    sync_person(s, "candidate", cand_id, "all_completed")
    s.query(M.CustodyLine).filter(M.CustodyLine.personKind == "candidate", M.CustodyLine.personId == cand_id) \
        .update({"personKind": "employee", "personId": civil, "civilId": civil}, synchronize_session=False)


def build_lines(s, tx, persons, ctx):
    """persons = [{id, items: {رقم البند: المبلغ}}] (البند اللي مش موجود = الشخص مش محتاجه) ← (بنود، رسالة خطأ)."""
    kind = TX_TYPES[tx]["kind"]
    fees = {f.id: f for f in s.scalars(select(M.FeeItem).where(M.FeeItem.txType == tx))}
    cc_co = db.cost_center_companies(s)
    lines, seen = [], set()
    for p in persons:
        pid = str(p.get("id") or "").strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        if kind == "employee":
            e = s.get(M.Employee, pid)
            if not e:
                return None, f"الموظف {pid} غير موجود"
            affs = db.get_affiliations(s, pid)
            if ctx and not ctx.affs_ok(affs, cc_co.get(e.costCenter), e.costCenter):
                return None, f"الموظف {e.name} برّه نطاقك"
            name, civil, cc, co = e.name, e.id, e.costCenter, next((a["companyId"] for a in affs if a.get("companyId")), None)
        else:
            c = s.get(M.Candidate, pid)
            if not c:
                return None, "المترشّح غير موجود"
            if ctx and not ctx.record_ok(c.targetCompanyId, cc_co.get(c.costCenter), c.costCenter):
                return None, f"المترشّح {c.name} برّه نطاقك"
            name, civil, cc, co = c.name, c.civilId, c.costCenter, c.targetCompanyId
        for fid, amount in (p.get("items") or {}).items():
            f = fees.get(fid)
            if f is None:
                continue
            lines.append(M.CustodyLine(personKind=kind, personId=pid, personName=name, civilId=civil, costCenter=cc,
                                       companyId=co, feeItemId=f.id, itemName=f.name, itemNameEn=f.nameEn,
                                       authority=f.authority, stage=f.stage,
                                       position=f.position, planned=num(amount), done=False))
    if not lines:
        return None, "اختار موظف واحد على الأقل وبند واحد على الأقل"
    return lines, None


def ready_people(s, c):
    """الأشخاص اللي كل بنودهم «تم» ولسه ماتقفلوش ← {رقم الشخص: [بنوده]}."""
    by = {}
    for ln in s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == c.id)):
        by.setdefault(ln.personId, []).append(ln)
    return {pid: ls for pid, ls in by.items() if all(x.done for x in ls) and not any(x.closedDate for x in ls)}


def close_people(s, c, person_ids, admin_fee, when):
    """تقفيل الأشخاص دول (لازم يكونوا جاهزين) ← بنودهم closed_date = when. العهدة بتتقفل لما كل الناس تتقفل.
    بيرجّع (بنود الكشف، رسالة خطأ)."""
    ready = ready_people(s, c)
    chosen = [pid for pid in dict.fromkeys(person_ids or []) if pid in ready]
    if not chosen:
        return None, "مفيش أشخاص جاهزين للتقفيل (كل بنود الشخص لازم تكون «تم»)"
    lines = [ln for pid in chosen for ln in ready[pid]]
    for ln in lines:
        ln.closedDate = when
    c.adminFee = admin_fee
    s.flush()
    if not s.scalar(select(func.count()).select_from(M.CustodyLine).where(M.CustodyLine.custodyId == c.id,
                                                                        M.CustodyLine.closedDate.is_(None))):
        c.status, c.closedDate = "closed", when
    return lines, None


def reopen(s, c, when):
    """إلغاء كشف تقفيل بتاريخه: البنود ترجع مفتوحة، والعهدة ترجع «تم الصرف»."""
    n = s.query(M.CustodyLine).filter(M.CustodyLine.custodyId == c.id, M.CustodyLine.closedDate == when) \
        .update({"closedDate": None}, synchronize_session=False)
    if n and c.status == "closed":
        c.status, c.closedDate = "disbursed", None
    return n


def next_no(s):
    return (s.scalar(select(func.max(M.Custody.no))) or 0) + 1


def dump(s, ctx):
    """للواجهة: جدول الرسوم والعهد ببنودها. المستخدم المحدود بشركات بيشوف العهدة لو فيها حد من نطاقه."""
    lines = {}
    for ln in s.scalars(select(M.CustodyLine).order_by(M.CustodyLine.custodyId, M.CustodyLine.personName,
                                                       M.CustodyLine.personId, M.CustodyLine.position)):
        lines.setdefault(ln.custodyId, []).append(db.to_dict(ln))
    out = []
    for c in s.scalars(select(M.Custody).order_by(M.Custody.no.desc())):
        ls = lines.get(c.id, [])
        if ctx and not ctx.allCompanies and not any(ctx.company_ok(x["companyId"]) for x in ls if x["companyId"]) \
                and not (c.companyId and ctx.company_ok(c.companyId)):
            continue
        d = db.to_dict(c)
        d["lines"] = ls
        out.append(d)
    return {
        "custodies": out,
        "feeItems": [db.to_dict(f) for f in s.scalars(select(M.FeeItem).order_by(M.FeeItem.txType, M.FeeItem.position))],
    }
