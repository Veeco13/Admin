# -*- coding: utf-8 -*-
"""
Lunx — العهد والمصروفات.

الفلوس كلها من الشركة المُصدِرة (أبراج انرجي — «إعدادات الفواتير»): بتتصرف عهدة لمستلم يدفع بيها رسوم معاملات
موظفين أو مترشّحين من أي مركز تكلفة، وبعد التنفيذ الشركة بتعمل فاتورة لكل مركز تكلفة:
  طلب (بيتطبع ويتعتمد على الورق) ← «تم الصرف» (المبلغ وتاريخه) ← تنفيذ البنود ← تقفيل ← فاتورة لكل مركز تكلفة
  (الرسوم الفعلية + الدعم الإداري مرة لكل موظف، ومافيش دعم لمراكز تكلفة الشركة نفسها) ← موافقة الحسابات.
- بنود العهدة من جدول الرسوم (fee_items) حسب نوع الطلب، ولكل شخص نسخة من البند والمبلغ ومركز التكلفة وقت الطلب.
- البند مربوط بمرحلة: لما مرحلة الشخص (المعاملة الحكومية للموظف أو «تسجيل موظف جديد» للمترشّح) تعدّي مرحلة
  البند، بيتعلّم «تم» لوحده (sync_person) والمبلغ الفعلي = المحدد لحد ما يتعدّل.
- الرصيد مع المستلم = المصروف له − المنفّذ فعلًا (البنود اللي «تم»).
- الفاتورة «بانتظار موافقة الحسابات» ← التقفيل بيتلغي وهي بتتمسح. «اعتمدتها الحسابات» ← نهائية.
- كل عهدة ليها صاحب (المستخدم اللي طلبها) ورقمها برمزه «AA-0001». المستخدم بيشوف عهده بس، وصاحب
  «custody.all» (عرض عهد كل المستخدمين — مدير النظام) بيشوف الكل. مدير النظام بينقل الملكية.
- منع التكرار (على عهد كل المستخدمين): الشخص مايتطلبش في عهدتين مفتوحتين من نفس النوع، ولو اتقفل له نفس النوع
  في آخر 90 يوم لازم تأكيد (dup_ok)، والتقفيل بيرفض شخص اتقفل له نفس النوع في عهدة تانية في آخر 90 يوم.
"""
import json
import re
from datetime import date, timedelta

from sqlalchemy import func, select

import db
import models as M
import pdf_forms

# أنواع الطلب: على مين (موظف / مترشّح)، ومراحل مين، والعمالة الوطنية (True = الكويتيين بس، False = من غيرهم)
TX_TYPES = {
    "renewal": {"label": "تجديد إقامة", "en": "Residency Renewal", "kind": "employee", "flow": "gov", "kuwaiti": False},
    "transfer_in": {"label": "تحويل إقامة من الداخل", "en": "Residency Transfer (within the group)", "kind": "employee",
                    "flow": "gov", "kuwaiti": False},
    "transfer_out": {"label": "تحويل إقامة من الخارج", "en": "Residency Transfer (from another sponsor)", "kind": "candidate",
                     "flow": "internal"},
    "visa": {"label": "إصدار تأشيرة عمل", "en": "Work Visa Issuance", "kind": "candidate", "flow": "outside"},
    "first_residency": {"label": "إصدار إقامة أول مرة", "en": "First Residency Issuance", "kind": "candidate", "flow": "outside"},
    "kw_permit_new": {"label": "إصدار إذن عمل — عمالة وطنية", "en": "Work Permit Issuance (National Labor)",
                      "kind": "candidate", "flow": "kuwaiti", "kuwaiti": True},
    "kw_permit_renewal": {"label": "تجديد إذن عمل — عمالة وطنية", "en": "Work Permit Renewal (National Labor)",
                          "kind": "employee", "flow": "gov", "kuwaiti": True},
    # بعد تجديد الجواز: نقل الإقامة والبيانات للجواز الجديد (رسوم البطاقة المدنية — بيتعلّم «تم» يدوي)
    "passport_transfer": {"label": "نقل بيانات الجواز", "en": "Passport Data Transfer", "kind": "employee", "flow": "gov",
                          "kuwaiti": False},
}
DEFAULT_ADMIN_FEE = 20            # الدعم الإداري لكل موظف في الفاتورة (الافتراضي — من «إعدادات الفواتير»)
# ترتيب المراحل (نفس GOV_STAGES و RECRUIT_STAGES_* في static/js/core.js — لو اتغيّروا هناك يتغيّروا هنا).
# المرحلة = الخطوة الشغالة دلوقتي، فالبند «تم» لما الشخص يوصل مرحلة بعد مرحلته أو آخر مرحلة.
FLOWS = {
    "gov": ("awaiting_contract", "awaiting_work_permit", "health_insurance", "residency", "civil_id", "renewed"),
    "outside": ("work_permit", "work_visa", "medical_exam", "foreign_ministry_auth", "employment_contract", "work_license",
                "health_insurance", "residency_issue", "civil_id_issue", "all_completed"),
    "internal": ("employment_contract", "sponsor_approval", "transfer_work_license", "health_insurance_internal",
                 "residency_issue_internal", "civil_id_renew", "all_completed"),
    "kuwaiti": ("kw_forms", "kw_pifss", "kw_work_permit", "kw_labor_support", "all_completed"),
}
STATUSES = {"requested": "مطلوبة", "disbursed": "تم الصرف", "closed": "مقفولة", "cancelled": "ملغاة"}
OPEN = ("requested", "disbursed")
SETTINGS_KEY = "custody_settings"
DUP_DAYS = 90                     # نفس الشخص ونفس النوع اتقفل في آخر 90 يوم ← تأكيد قبل الطلب، والتقفيل بيرفضه
DOC_LANGS = ("ar", "en", "both")  # لغة ملفات العهد (الفواتير، الملخص، طلب الصرف، كشف الموظف)
CODE_RE = re.compile(r"^[A-Z][A-Z0-9]{1,5}$")


def num(v):
    try:
        return round(float(v), 3) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def amount(ln):
    """المبلغ الفعلي للبند (أو المحدد لو الفعلي ماتكتبش)."""
    return float((ln.actual if ln.actual is not None else ln.planned) or 0)


# ---------------------------------------------------------------------------
# إعدادات الفواتير: الشركة المُصدِرة، الدعم الإداري الافتراضي، ومراكز التكلفة اللي مالهاش دعم
# ---------------------------------------------------------------------------
def settings(s):
    try:
        d = json.loads(db.get_meta(s, SETTINGS_KEY) or "{}")
    except ValueError:
        d = {}
    issuer = d.get("issuerCompanyId")
    if not issuer or s.get(M.Company, issuer) is None:            # الافتراضي: «Abraaj Energy …»
        companies = s.scalars(select(M.Company).order_by(M.Company.id)).all()
        issuer = next((c.id for c in companies if (c.nameEn or "").lower().startswith("abraaj energy")),
                      companies[0].id if companies else None)
    fee = num(d.get("supportFee"))
    no_support = d.get("noSupportCostCenters")
    if no_support is None:                                         # الافتراضي: مركز التكلفة اللي اسمه اسم الشركة نفسها
        ic = s.get(M.Company, issuer) if issuer else None
        key = (ic.nameEn or "").lower() if ic is not None else ""
        no_support = [cc.name for cc in s.scalars(select(M.CostCenter))
                      if key and (cc.nameEn or "").strip() and (cc.nameEn or "").strip().lower() in key]
    return {"issuerCompanyId": issuer, "supportFee": DEFAULT_ADMIN_FEE if fee is None else fee,
            "noSupportCostCenters": no_support, "docLang": d.get("docLang") if d.get("docLang") in DOC_LANGS else "both"}


def save_settings(s, d):
    cur = settings(s)
    issuer = d.get("issuerCompanyId") if s.get(M.Company, d.get("issuerCompanyId") or "") is not None else cur["issuerCompanyId"]
    fee = num(d.get("supportFee"))
    names = {cc.name for cc in s.scalars(select(M.CostCenter))}
    no_support = [x for x in (d.get("noSupportCostCenters") or []) if x in names]
    lang = d.get("docLang") if d.get("docLang") in DOC_LANGS else cur["docLang"]
    db.set_meta(s, SETTINGS_KEY, json.dumps({"issuerCompanyId": issuer, "supportFee": cur["supportFee"] if fee is None else fee,
                                             "noSupportCostCenters": no_support, "docLang": lang}, ensure_ascii=False))
    return settings(s)


# ---------------------------------------------------------------------------
# الربط بالمراحل
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# الطلب
# ---------------------------------------------------------------------------
def build_lines(s, tx, persons, ctx):
    """persons = [{id, items: {رقم البند: المبلغ}}] (البند اللي مش موجود = الشخص مش محتاجه) ← (بنود، رسالة خطأ)."""
    kind, kuwaiti = TX_TYPES[tx]["kind"], TX_TYPES[tx].get("kuwaiti")
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
            name, civil, cc, kw = e.name, e.id, e.costCenter, pdf_forms.is_kuwaiti(e.nationality)
            co = next((a["companyId"] for a in affs if a.get("companyId")), None)
        else:
            c = s.get(M.Candidate, pid)
            if not c:
                return None, "المترشّح غير موجود"
            if ctx and not ctx.record_ok(c.targetCompanyId, cc_co.get(c.costCenter), c.costCenter):
                return None, f"المترشّح {c.name} برّه نطاقك"
            name, civil, cc, co = c.name, c.civilId, c.costCenter, c.targetCompanyId
            kw = c.source == "kuwaiti" or pdf_forms.is_kuwaiti(c.nationality)
        if kuwaiti is True and not kw:
            return None, f"{name}: النوع ده للعمالة الوطنية بس (الكويتيين ومعاملة كويتية)"
        if kuwaiti is False and kw:
            if tx == "passport_transfer":
                return None, f"{name}: «{TX_TYPES[tx]['label']}» مش للعمالة الوطنية"
            return None, f"{name}: العمالة الوطنية ليها «{TX_TYPES['kw_permit_renewal']['label']}»"
        for fid, value in (p.get("items") or {}).items():
            f = fees.get(fid)
            if f is None:
                continue
            lines.append(M.CustodyLine(personKind=kind, personId=pid, personName=name, civilId=civil, costCenter=cc,
                                       companyId=co, feeItemId=f.id, itemName=f.name, itemNameEn=f.nameEn,
                                       authority=f.authority, stage=f.stage,
                                       position=f.position, planned=num(value), done=False))
    if not lines:
        return None, "اختار موظف واحد على الأقل وبند واحد على الأقل"
    return lines, None


def next_no(s):
    """الرقم الداخلي (فريد لكل العهد). الرقم اللي بيظهر = custody_no."""
    return (s.scalar(select(func.max(M.Custody.no))) or 0) + 1


# ---------------------------------------------------------------------------
# صاحب العهدة ورقمها «AA-0001»
# ---------------------------------------------------------------------------
def custody_no(c):
    """رمز صاحب العهدة وقت الطلب + مسلسل الرمز."""
    return f"{c.prefix}-{c.seq:04d}" if c.prefix and c.seq else f"CUS-{c.no:04d}"


def default_code(s, u):
    """الحروف الأولى لأجزاء اسم الدخول (a.ahmed ← AA) أو أول 3 حروف (admin ← ADM) — ومن غير تكرار."""
    taken = {x for x in s.scalars(select(M.User.custodyCode).where(M.User.id != u.id)) if x}
    parts = [p for p in re.split(r"[^A-Za-z]+", u.username or "") if p]
    base = ("".join(p[0] for p in parts) if len(parts) > 1 else (parts[0][:3] if parts else "")).upper()
    if len(base) < 2:
        base = f"U{u.id}"
    code, n = base, 2
    while code in taken:
        code, n = f"{base}{n}", n + 1
    return code


def check_code(s, uid, code):
    """رمز جديد لمستخدم ← (الرمز، رسالة خطأ)."""
    code = (code or "").strip().upper()
    if not CODE_RE.match(code):
        return None, "رمز العهد: من 2 لـ 6 حروف وأرقام إنجليزي، ويبدأ بحرف (مثلًا AA أو AHM)"
    if s.scalar(select(func.count()).select_from(M.User).where(M.User.custodyCode == code, M.User.id != uid)):
        return None, f"الرمز {code} مستخدم لحد تاني"
    return code, None


def user_code(s, uid):
    """رمز المستخدم في أرقام العهد (بيتحدد لوحده أول مرة لو مالوش)."""
    u = s.get(M.User, uid) if uid else None
    if u is None:
        return "CUS"
    if not u.custodyCode:
        u.custodyCode = default_code(s, u)
    return u.custodyCode


def assign_owner(s, c, uid):
    """العهدة بقت ملك المستخدم ده ← رقم جديد برمزه ومسلسله."""
    c.ownerId, c.prefix = uid, user_code(s, uid)
    c.seq = (s.scalar(select(func.max(M.Custody.seq)).where(M.Custody.prefix == c.prefix, M.Custody.id != c.id)) or 0) + 1


def can_see(ctx, c):
    """صاحب العهدة، أو صاحب «عرض عهد كل المستخدمين» (مدير النظام)."""
    return ctx is None or ctx.can("custody.all") or c.ownerId == ctx.id


def user_names(s):
    return {u.id: u.displayName or u.username for u in s.scalars(select(M.User))}


# ---------------------------------------------------------------------------
# منع التكرار (على عهد كل المستخدمين)
# ---------------------------------------------------------------------------
def duplicates(s, tx, person_ids, exclude=None):
    """الأشخاص دول في عهد تانية من نفس النوع ← (مفتوحة، اتقفلت خلال DUP_DAYS يوم) — {رقم الشخص: (الاسم، رقم العهدة، صاحبها أو تاريخ التقفيل)}."""
    ids = [x for x in dict.fromkeys(str(p or "").strip() for p in person_ids) if x]
    if not ids:
        return {}, {}
    q = select(M.CustodyLine, M.Custody).join(M.Custody, M.Custody.id == M.CustodyLine.custodyId).where(
        M.Custody.txType == tx, M.Custody.status != "cancelled", M.CustodyLine.personKind == TX_TYPES[tx]["kind"],
        M.CustodyLine.personId.in_(ids))
    if exclude:
        q = q.where(M.Custody.id != exclude)
    since, names = date.today() - timedelta(days=DUP_DAYS), user_names(s)
    open_, recent = {}, {}
    for ln, c in s.execute(q):
        if c.status in OPEN and ln.closedDate is None:
            open_.setdefault(ln.personId, (ln.personName, custody_no(c), names.get(c.ownerId, "")))
        elif ln.closedDate and ln.closedDate >= since:
            recent.setdefault(ln.personId, (ln.personName, custody_no(c), ln.closedDate))
    return open_, recent


def busy(s):
    """للواجهة (قايمة الاختيار في الطلب): الأشخاص في عهد مفتوحة أو اتقفلوا خلال DUP_DAYS يوم — من كل المستخدمين،
    بالرقم وصاحب العهدة بس."""
    since, names, out = date.today() - timedelta(days=DUP_DAYS), user_names(s), []
    q = select(M.CustodyLine.personKind, M.CustodyLine.personId, M.CustodyLine.closedDate, M.Custody) \
        .join(M.Custody, M.Custody.id == M.CustodyLine.custodyId).where(M.Custody.status != "cancelled")
    seen = set()
    for kind, pid, closed, c in s.execute(q):
        state = "open" if c.status in OPEN and closed is None else "recent" if closed and closed >= since else None
        if state and (c.id, pid, state) not in seen:
            seen.add((c.id, pid, state))
            out.append({"kind": kind, "personId": pid, "txType": c.txType, "custodyId": c.id, "number": custody_no(c),
                        "owner": names.get(c.ownerId, ""), "state": state, "closedDate": db.ser(closed)})
    return out


# ---------------------------------------------------------------------------
# التقفيل والفواتير
# ---------------------------------------------------------------------------
def ready_people(s, c):
    """الأشخاص اللي كل بنودهم «تم» ولسه ماتقفلوش ← {رقم الشخص: [بنوده]}."""
    by = {}
    for ln in s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == c.id)):
        by.setdefault(ln.personId, []).append(ln)
    return {pid: ls for pid, ls in by.items() if all(x.done for x in ls) and not any(x.closedDate for x in ls)}


def invoice_no(inv):
    return f"INV-{inv.year}-{inv.no:04d}"


def make_invoices(s, c, lines, fee, when, user):
    """فاتورة لكل مركز تكلفة في التقفيل: الرسوم الفعلية + الدعم الإداري مرة لكل موظف (إلا مراكز الشركة نفسها)."""
    st = settings(s)
    cc_co = db.cost_center_companies(s)
    by_cc = {}
    for ln in lines:
        by_cc.setdefault(ln.costCenter or "", []).append(ln)
    out = []
    for cc, ls in sorted(by_cc.items()):
        people = len({ln.personId for ln in ls})
        gov = round(sum(amount(ln) for ln in ls), 3)
        support = 0.0 if cc in st["noSupportCostCenters"] else float(fee)
        no = (s.scalar(select(func.max(M.Invoice.no)).where(M.Invoice.year == when.year)) or 0) + 1
        inv = M.Invoice(id=db.new_id("inv"), year=when.year, no=no, custodyId=c.id, closingDate=when, costCenter=cc or None,
                        billCompanyId=cc_co.get(cc) or next((ln.companyId for ln in ls if ln.companyId), None),
                        issuerCompanyId=st["issuerCompanyId"], employees=people, govAmount=gov, supportFee=support,
                        supportAmount=round(support * people, 3), total=round(gov + support * people, 3), status="pending",
                        createdBy=user, createdAt=db.now())
        s.add(inv)
        s.flush()
        out.append(inv)
    return out


def close_people(s, c, person_ids, fee, when, user):
    """تقفيل الأشخاص دول (لازم يكونوا جاهزين) ← بنودهم closed_date = when، وفاتورة لكل مركز تكلفة.
    العهدة بتتقفل لما كل الناس تتقفل. بيرجّع (البنود، الفواتير، رسالة خطأ)."""
    ready = ready_people(s, c)
    chosen = [pid for pid in dict.fromkeys(person_ids or []) if pid in ready]
    if not chosen:
        return None, None, "مفيش أشخاص جاهزين للتقفيل (كل بنود الشخص لازم تكون «تم»)"
    if s.scalar(select(func.count()).select_from(M.Invoice).where(M.Invoice.custodyId == c.id, M.Invoice.closingDate == when)):
        return None, None, "فيه تقفيل بنفس التاريخ للعهدة دي — اختار تاريخ تاني أو ألغي التقفيل القديم"
    # فحص أمان: نفس الشخص ونفس النوع اتقفل (اتفوتر) في عهدة تانية في آخر 90 يوم ← مايتفوترش مرتين
    # (إلا لو اتطلب تاني بتأكيد — dup_ok)
    check = [pid for pid in chosen if not any(ln.dupOk for ln in ready[pid])]
    since, dup = when - timedelta(days=DUP_DAYS), {}
    if check:
        q = select(M.CustodyLine, M.Custody).join(M.Custody, M.Custody.id == M.CustodyLine.custodyId).where(
            M.Custody.id != c.id, M.Custody.txType == c.txType, M.CustodyLine.personKind == TX_TYPES[c.txType]["kind"],
            M.CustodyLine.personId.in_(check), M.CustodyLine.closedDate >= since)
        for ln, other in s.execute(q):
            dup.setdefault(ln.personId, f"{ln.personName} ({custody_no(other)} — {ln.closedDate.strftime('%d/%m/%Y')})")
    if dup:
        return None, None, (f"اتقفل لهم نفس النوع في عهدة تانية خلال آخر {DUP_DAYS} يوم (علشان مايتفوتروش مرتين): "
                            + "، ".join(dup.values()))
    lines = [ln for pid in chosen for ln in ready[pid]]
    for ln in lines:
        ln.closedDate = when
    c.adminFee = fee
    s.flush()
    invoices = make_invoices(s, c, lines, fee, when, user)
    if not s.scalar(select(func.count()).select_from(M.CustodyLine).where(M.CustodyLine.custodyId == c.id,
                                                                        M.CustodyLine.closedDate.is_(None))):
        c.status, c.closedDate = "closed", when
    return lines, invoices, None


def reopen(s, c, when):
    """إلغاء تقفيل بتاريخه (فواتيره لسه بانتظار الحسابات): الفواتير بتتمسح، والبنود ترجع مفتوحة، والعهدة «تم الصرف».
    بيرجّع (عدد البنود، رسالة خطأ)."""
    invoices = s.scalars(select(M.Invoice).where(M.Invoice.custodyId == c.id, M.Invoice.closingDate == when)).all()
    approved = [invoice_no(i) for i in invoices if i.status == "approved"]
    if approved:
        return 0, f"الحسابات اعتمدت {'، '.join(approved)} — مينفعش التقفيل يتلغي"
    for inv in invoices:
        s.delete(inv)
    n = s.query(M.CustodyLine).filter(M.CustodyLine.custodyId == c.id, M.CustodyLine.closedDate == when) \
        .update({"closedDate": None}, synchronize_session=False)
    if n and c.status == "closed":
        c.status, c.closedDate = "disbursed", None
    return n, None


def dump(s, ctx):
    """للواجهة: جدول الرسوم والإعدادات والعهد ببنودها وفواتيرها. المستخدم بيشوف عهده بس (وصاحب custody.all الكل)،
    والمحدود بشركات بيشوف العهدة لو فيها حد من نطاقه. custodyBusy = مين في عهد مفتوحة أو اتقفل قريب (من كل المستخدمين)."""
    names = user_names(s)
    lines = {}
    for ln in s.scalars(select(M.CustodyLine).order_by(M.CustodyLine.custodyId, M.CustodyLine.personName,
                                                       M.CustodyLine.personId, M.CustodyLine.position)):
        lines.setdefault(ln.custodyId, []).append(db.to_dict(ln))
    out, visible = [], set()
    for c in s.scalars(select(M.Custody).order_by(M.Custody.no.desc())):
        ls = lines.get(c.id, [])
        if not can_see(ctx, c):
            continue
        if ctx and not ctx.allCompanies and not any(ctx.company_ok(x["companyId"]) for x in ls if x["companyId"]) \
                and not (c.companyId and ctx.company_ok(c.companyId)):
            continue
        d = db.to_dict(c)
        d["lines"], d["number"], d["ownerName"] = ls, custody_no(c), names.get(c.ownerId, "")
        out.append(d)
        visible.add(c.id)
    invoices = []
    for inv in s.scalars(select(M.Invoice).order_by(M.Invoice.year.desc(), M.Invoice.no.desc())):
        if inv.custodyId in visible:
            d = db.to_dict(inv)
            d["number"] = invoice_no(inv)
            invoices.append(d)
    see_all = ctx is None or ctx.can("custody.all")
    return {
        "custodies": out,
        "invoices": invoices,
        "custodySettings": settings(s),
        "custodyBusy": busy(s),
        "custodyUsers": [{"id": u.id, "name": u.displayName or u.username, "code": u.custodyCode}
                         for u in s.scalars(select(M.User).order_by(M.User.id))] if see_all else [],
        "feeItems": [db.to_dict(f) for f in s.scalars(select(M.FeeItem).order_by(M.FeeItem.txType, M.FeeItem.position))],
    }
