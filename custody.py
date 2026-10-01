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
# بند التجديد بيحدّث تاريخ في بيانات الموظف (fee_items.updates_field) ← الانتهاء الجديد بيتسجّل عليه قبل التقفيل
EXPIRY_FIELDS = {"residencyExp": "الإقامة", "workPermitExp": "إذن العمل", "healthCardExp": "البطاقة الصحية"}
RENEWAL_TYPES = ("renewal", "kw_permit_renewal")      # لما كل بنود الموظف تخلص ← مرحلة المعاملة «تم التجديد»
OPEN = ("requested", "disbursed")
SETTINGS_KEY = "custody_settings"
DUP_DAYS = 90                     # نفس الشخص ونفس النوع اتقفل في آخر 90 يوم ← تأكيد قبل الطلب، والتقفيل بيرفضه
DOC_LANGS = ("ar", "en", "both")  # لغة ملفات العهد (الفواتير، الملخص، طلب الصرف، كشف الموظف)
CODE_RE = re.compile(r"^[A-Z][A-Z0-9]{1,5}$")
CC_CODE_RE = re.compile(r"^[A-Z][A-Z0-9]{1,4}$")
NO_CC_CODE = "GEN"                # فاتورة للي مالهمش مركز تكلفة


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
    if not issuer or s.get(M.Company, issuer) is None:            # لسه ماتحددتش في «إعدادات الفواتير» ← أول شركة
        issuer = s.scalar(select(M.Company.id).order_by(M.Company.id))
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


def record_expiry(s, c, ln, new_date, user):
    """الانتهاء الجديد لبند تجديد ← على البند، وفي بيانات الموظف لو التاريخ اللي عنده أقدم (سجل الموظف وتاريخ الشركة
    للإقامة). لازم يبقى بعد التاريخ وقت الطلب. بيرجّع رسالة خطأ أو None."""
    if not ln.updatesField or ln.personKind != "employee":
        return "البند ده مابيجددش تاريخ"
    if ln.closedDate:
        return "البند اتقفل — ألغي التقفيل الأول لو محتاج تعدّله"
    label = EXPIRY_FIELDS.get(ln.updatesField, ln.updatesField)
    if not new_date:
        ln.newExpiry = None
        return None
    if ln.oldExpiry and new_date <= ln.oldExpiry:
        return f"{ln.personName} — {label}: الانتهاء الجديد لازم يبقى بعد القديم ({ln.oldExpiry.strftime('%d/%m/%Y')})"
    ln.newExpiry = new_date
    e = s.get(M.Employee, ln.personId)
    cur = getattr(e, ln.updatesField) if e is not None else None
    if e is not None and (cur is None or cur < new_date):
        setattr(e, ln.updatesField, new_date)
        e.lastUpdated, e.lastUpdatedBy = db.now(), user
        db.push_timeline(s, e.id, "renew", f"تجديد {label}: {db.ser(cur) or '—'} ← {new_date.isoformat()} (عهدة {custody_no(c)})", user)
        if ln.updatesField == "residencyExp":
            aff = db.get_affiliations(s, e.id)
            if aff and aff[0].get("companyId"):
                db.log_company_history(s, aff[0]["companyId"], "residency_renewed",
                                       f"تجديد إقامة {e.name} حتى {new_date.isoformat()} (عهدة {custody_no(c)})", user)
    return None


def mark_renewed(s, c, person_id, user):
    """عهدة تجديد: كل بنود الموظف «تم» وتواريخها الجديدة متسجّلة ← مرحلة المعاملة «تم التجديد»."""
    if c.txType not in RENEWAL_TYPES:
        return False
    ls = list(s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == c.id, M.CustodyLine.personKind == "employee",
                                                     M.CustodyLine.personId == person_id)))
    if not ls or not all(x.done for x in ls) or any(x.updatesField and not x.newExpiry for x in ls):
        return False
    e = s.get(M.Employee, person_id)
    if e is None or e.govStage == "renewed":
        return False
    e.govStage, e.govStageNote = "renewed", None
    e.lastUpdated, e.lastUpdatedBy = db.now(), user
    db.push_timeline(s, e.id, "gov_stage", f"مرحلة المعاملة: تم التجديد (عهدة {custody_no(c)})", user)
    return True


def fill_open_expiry(s, employee_id, field, new_date):
    """الموظف اتجدد من برّه العهدة («تجديد سريع») ← بنود التجديد المفتوحة لنفس التاريخ بتاخد الانتهاء الجديد."""
    q = select(M.CustodyLine).join(M.Custody, M.Custody.id == M.CustodyLine.custodyId).where(
        M.Custody.status.in_(OPEN), M.CustodyLine.personKind == "employee", M.CustodyLine.personId == employee_id,
        M.CustodyLine.updatesField == field, M.CustodyLine.newExpiry.is_(None), M.CustodyLine.closedDate.is_(None))
    n = 0
    for ln in s.scalars(q):
        if not ln.oldExpiry or new_date > ln.oldExpiry:
            ln.newExpiry = new_date
            n += 1
    return n


def renewing(s):
    """للتنبيهات: الموظفين اللي عليهم بند تجديد مفتوح لسه تاريخه الجديد ماتسجلش ← {الرقم المدني: {التاريخ: رقم العهدة}}."""
    out = {}
    q = select(M.CustodyLine, M.Custody).join(M.Custody, M.Custody.id == M.CustodyLine.custodyId).where(
        M.Custody.status.in_(OPEN), M.CustodyLine.personKind == "employee", M.CustodyLine.updatesField.isnot(None),
        M.CustodyLine.newExpiry.is_(None), M.CustodyLine.closedDate.is_(None))
    for ln, c in s.execute(q):
        out.setdefault(ln.personId, {})[ln.updatesField] = custody_no(c)
    return out


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
            person = e
        else:
            c = s.get(M.Candidate, pid)
            if not c:
                return None, "المترشّح غير موجود"
            if ctx and not ctx.record_ok(c.targetCompanyId, cc_co.get(c.costCenter), c.costCenter):
                return None, f"المترشّح {c.name} برّه نطاقك"
            name, civil, cc, co = c.name, c.civilId, c.costCenter, c.targetCompanyId
            kw = c.source == "kuwaiti" or pdf_forms.is_kuwaiti(c.nationality)
            person = None
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
            upd = f.updatesField if person is not None and f.updatesField in EXPIRY_FIELDS else None
            lines.append(M.CustodyLine(personKind=kind, personId=pid, personName=name, civilId=civil, costCenter=cc,
                                       companyId=co, feeItemId=f.id, itemName=f.name, itemNameEn=f.nameEn,
                                       authority=f.authority, stage=f.stage,
                                       position=f.position, planned=num(value), done=False,
                                       updatesField=upd, oldExpiry=getattr(person, upd) if upd else None))
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
    """رمز جديد لمستخدم ← (الرمز، رسالة خطأ). الرمز بيتحدد مرة واحدة ومايتغيّرش بعد كده."""
    code = (code or "").strip().upper()
    u = s.get(M.User, uid) if uid else None
    if u is not None and u.custodyCode and code != u.custodyCode:
        return None, f"رمز العهد {u.custodyCode} مايتغيّرش"
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


def sees_all(ctx):
    """«عرض عهد كل المستخدمين» (مدير النظام)، أو المحاسب (حسابات العهد)."""
    return ctx is None or ctx.can("custody.all") or ctx.can("custody.accounts")


def can_see(ctx, c):
    """صاحب العهدة، أو اللي بيشوف عهد الكل (sees_all)."""
    return sees_all(ctx) or c.ownerId == ctx.id


def user_names(s):
    return {u.id: u.displayName or u.username for u in s.scalars(select(M.User))}


# ---------------------------------------------------------------------------
# منع التكرار (على عهد كل المستخدمين)
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# التقفيل المباشر: مبلغه «مستحق» بيتضاف على أقرب طلب عهدة لنفس المستلم
# ---------------------------------------------------------------------------
FUNDED = ("disbursed", "closed")


def due_amount(s, c):
    """مبلغ التقفيل المباشر (اللي اتنفّذ فعلًا)."""
    return round(sum(amount(ln) for ln in s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == c.id)) if ln.done), 3)


def carried(s, c):
    """التقفيلات المباشرة المضافة على الطلب ده ← [(العهدة، المبلغ)]."""
    return [(x, due_amount(s, x)) for x in s.scalars(select(M.Custody).where(M.Custody.carryToId == c.id, M.Custody.direct.is_(True),
                                                                       M.Custody.status != "cancelled").order_by(M.Custody.no))]


def link_dues(s, c, ids, ctx):
    """ids = التقفيلات المباشرة اللي تتضاف على الطلب ده (None = سيب المربوط زي ما هو). لازم تكون لنفس المستلم، مقفولة،
    ومش مضافة على طلب تاني. اللي اتشال من القايمة بيتفك. بيرجّع (إجمالي المستحقات، رسالة خطأ)."""
    who = (c.custodian or "").strip()
    for x, _ in carried(s, c):                        # المستلم في الطلب اتغيّر ← مستحقات المستلم القديم بتتفك
        if (x.custodian or "").strip() != who:
            x.carryToId = None
    if ids is not None:
        want = set(str(i) for i in ids)
        for x, _ in carried(s, c):
            if x.id not in want:
                x.carryToId = None
        for i in want:
            x = s.get(M.Custody, i)
            if x is None or not x.direct or not can_see(ctx, x):
                return 0, "التقفيل المباشر غير موجود"
            if x.carryToId == c.id:
                continue
            if x.status != "closed":
                return 0, f"{custody_no(x)}: التقفيل المباشر لازم يكون مقفول علشان يتضاف على طلب"
            if x.carryToId:
                return 0, f"{custody_no(x)} اتضاف على طلب تاني بالفعل"
            if (x.custodian or "").strip() != who:
                return 0, f"{custody_no(x)} بتاع مستلم تاني ({x.custodian})"
            x.carryToId = c.id
    s.flush()
    return round(sum(a for _, a in carried(s, c)), 3), None


def sync_carrier(s, c):
    """مبلغ التقفيل المباشر اتغيّر (إلغاء تقفيل / تعديل بند / إلغاء) ← «المطلوب» في الطلب اللي اتضاف عليه بيتحسب تاني
    (لو لسه ماتصرفش — بعد الصرف الرصيد بيتحسب من المبالغ الفعلية)."""
    carrier = s.get(M.Custody, c.carryToId) if c.direct and c.carryToId else None
    if carrier is None or carrier.status != "requested":
        return
    s.flush()
    planned = sum(ln.planned or 0 for ln in s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == carrier.id)))
    carrier.requestedAmount = round(planned + sum(a for _, a in carried(s, carrier)), 3)


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
def ready_lines(s, c):
    """الإجراءات «تم» اللي لسه ماتقفلتش — كل إجراء بيتقفل لوحده (مش لازم الشخص يخلّص كل إجراءاته)."""
    return [ln for ln in s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == c.id).order_by(M.CustodyLine.position))
            if ln.done and not ln.closedDate]


def earlier_closed(s, c, when):
    """الأشخاص اللي اتقفل لهم إجراء في تقفيل قبل `when` في نفس العهدة ← الدعم الإداري اتحسب لهم خلاص (مرة لكل موظف)."""
    return set(s.scalars(select(M.CustodyLine.personId).where(M.CustodyLine.custodyId == c.id, M.CustodyLine.closedDate < when)))


def ready_people(s, c):
    """الأشخاص اللي كل بنودهم «تم» ولسه ماتقفلوش ← {رقم الشخص: [بنوده]}."""
    by = {}
    for ln in s.scalars(select(M.CustodyLine).where(M.CustodyLine.custodyId == c.id)):
        by.setdefault(ln.personId, []).append(ln)
    return {pid: ls for pid, ls in by.items() if all(x.done for x in ls) and not any(x.closedDate for x in ls)}


def invoice_no(inv):
    """«INV-SUP-2026-0001»: رمز المركز وقت التقفيل + السنة + مسلسل المركز في السنة."""
    return f"INV-{inv.ccCode}-{inv.year}-{inv.no:04d}" if inv.ccCode else f"INV-{inv.year}-{inv.no:04d}"


# ---------------------------------------------------------------------------
# رمز مركز التكلفة (بيتقفل أول ما يتستخدم في فاتورة) — ورمز المستخدم (أول ما يتستخدم في عهدة)
# ---------------------------------------------------------------------------
def cc_default_code(s, cc):
    """أول 3 حروف من الاسم الإنجليزي (Superior energy ← SUP)، أو حرف الكلمة الأولى + حرفين من التانية — من غير تكرار."""
    taken = {x for x in s.scalars(select(M.CostCenter.code).where(M.CostCenter.id != cc.id)) if x} | {NO_CC_CODE}
    words = [w.upper() for w in re.split(r"[^A-Za-z]+", cc.nameEn or "") if w]
    cands = [words[0][:3]] if words else []
    if len(words) > 1:
        cands += [words[0][0] + words[1][:2], words[0][:2] + words[1][0]]
    base = next((c for c in cands if len(c) >= 2 and c not in taken), (cands[0] if cands and len(cands[0]) >= 2 else "CC"))[:4]
    code, n = base, 2
    while code in taken:
        code, n = f"{base}{n}", n + 1
    return code


def set_cc_code(s, cc, code):
    """رمز جديد لمركز تكلفة ← رسالة خطأ أو None. الرمز بيتحدد مرة واحدة ومايتغيّرش بعد كده."""
    code = (code or "").strip().upper()
    if code == (cc.code or ""):
        return None
    if cc.code:
        return f"رمز المركز {cc.code} مايتغيّرش"
    if not CC_CODE_RE.match(code) or code == NO_CC_CODE:
        return f"رمز المركز: من 2 لـ 5 حروف وأرقام إنجليزي، ويبدأ بحرف (مثلًا SUP) — و{NO_CC_CODE} محجوز"
    if s.scalar(select(func.count()).select_from(M.CostCenter).where(M.CostCenter.code == code, M.CostCenter.id != cc.id)):
        return f"الرمز {code} مستخدم لمركز تكلفة تاني"
    cc.code = code
    return None


def cc_code_for(s, name):
    """رمز مركز التكلفة بالاسم (بيتحدد لوحده لو مالوش) — ومن غير مركز ← GEN."""
    cc = s.scalar(select(M.CostCenter).where(M.CostCenter.name == name)) if name else None
    if cc is None:
        return NO_CC_CODE
    if not cc.code:
        cc.code = cc_default_code(s, cc)
    return cc.code


def make_invoices(s, c, lines, fee, when, user):
    """فاتورة لكل مركز تكلفة في التقفيل: الرسوم الفعلية + الدعم الإداري مرة لكل موظف في العهدة — في أول تقفيل
    فيه إجراء ليه، والتقفيلات اللي بعد كده لنفس الموظف مافيهاش دعم (إلا مراكز الشركة نفسها مالهاش دعم أصلًا).
    رقمها «INV-رمز المركز-السنة-مسلسل المركز في السنة»، وكلهم بياخدوا رقم التقفيل «AA-0001/1»."""
    seq = (s.scalar(select(func.max(M.Invoice.closingSeq)).where(M.Invoice.custodyId == c.id)) or 0) + 1
    ref = f"{custody_no(c)}/{seq}"
    st = settings(s)
    cc_co = db.cost_center_companies(s)
    earlier = earlier_closed(s, c, when)
    by_cc = {}
    for ln in lines:
        by_cc.setdefault(ln.costCenter or "", []).append(ln)
    out = []
    for cc, ls in sorted(by_cc.items()):
        people = len({ln.personId for ln in ls})
        charged = len({ln.personId for ln in ls} - earlier)          # أول مرة يتقفل لهم إجراء في العهدة دي
        gov = round(sum(amount(ln) for ln in ls), 3)
        support = 0.0 if cc in st["noSupportCostCenters"] else float(fee)
        code = cc_code_for(s, cc)
        no = (s.scalar(select(func.max(M.Invoice.no)).where(M.Invoice.year == when.year, M.Invoice.ccCode == code)) or 0) + 1
        inv = M.Invoice(id=db.new_id("inv"), year=when.year, no=no, ccCode=code, closingSeq=seq, closingRef=ref,
                        custodyId=c.id, closingDate=when, costCenter=cc or None,
                        billCompanyId=cc_co.get(cc) or next((ln.companyId for ln in ls if ln.companyId), None),
                        issuerCompanyId=st["issuerCompanyId"], employees=people, govAmount=gov, supportFee=support,
                        supportAmount=round(support * charged, 3), total=round(gov + support * charged, 3), status="pending",
                        createdBy=user, createdAt=db.now())
        s.add(inv)
        s.flush()
        out.append(inv)
    return out


def _line_key(ln):
    return ln.feeItemId or ln.itemName


def close_people(s, c, person_ids, fee, when, user):
    """(الطريقة القديمة) تقفيل كل الإجراءات الجاهزة للأشخاص دول ← close_lines."""
    ids = set(person_ids or [])
    return close_lines(s, c, [ln.id for ln in ready_lines(s, c) if ln.personId in ids], fee, when, user)


def close_lines(s, c, line_ids, fee, when, user):
    """تقفيل الإجراءات دي (لازم تكون «تم» ولسه ماتقفلتش) ← closed_date = when، وفاتورة لكل مركز تكلفة.
    الإجراء بيتقفل لوحده (مش لازم الشخص يخلّص كل إجراءاته)، والعهدة بتتقفل لما كل إجراءاتها تتقفل.
    بيرجّع (البنود، الفواتير، رسالة خطأ)."""
    ready = {str(ln.id): ln for ln in ready_lines(s, c)}          # الأرقام بتيجي من الواجهة نص أو رقم
    lines = [ready[str(i)] for i in dict.fromkeys(line_ids or []) if str(i) in ready]
    if not lines:
        return None, None, "مفيش إجراءات جاهزة للتقفيل (الإجراء لازم يكون «تم» ولسه ماتقفلش)"
    missing = [f"{ln.personName} ({EXPIRY_FIELDS.get(ln.updatesField, ln.updatesField)})" for ln in lines
               if ln.updatesField and ln.personKind == "employee" and not ln.newExpiry]
    if missing:                      # تقفيل التجديد بيحدّث بيانات الموظف ← التاريخ الجديد مطلوب
        return None, None, "سجّل تاريخ الانتهاء الجديد الأول: " + "، ".join(missing)
    if s.scalar(select(func.count()).select_from(M.Invoice).where(M.Invoice.custodyId == c.id, M.Invoice.closingDate == when)):
        return None, None, "فيه تقفيل بنفس التاريخ للعهدة دي — اختار تاريخ تاني أو ألغي التقفيل القديم"
    last = s.scalar(select(func.max(M.CustodyLine.closedDate)).where(M.CustodyLine.custodyId == c.id))
    if last and when < last:        # الترتيب مهم: الدعم الإداري بيتحسب في أول تقفيل للموظف
        return None, None, f"تاريخ التقفيل لازم يكون بعد آخر تقفيل للعهدة دي ({last.strftime('%d/%m/%Y')})"
    # فحص أمان: نفس الشخص ونفس الإجراء اتقفل (اتفوتر) في عهدة تانية في آخر 90 يوم ← مايتفوترش مرتين
    # (إلا لو اتطلب تاني بتأكيد — dup_ok)
    check = [ln for ln in lines if not ln.dupOk]
    since, dup = when - timedelta(days=DUP_DAYS), {}
    if check:
        keys = {(ln.personKind, ln.personId, _line_key(ln)) for ln in check}
        q = select(M.CustodyLine, M.Custody).join(M.Custody, M.Custody.id == M.CustodyLine.custodyId).where(
            M.Custody.id != c.id, M.CustodyLine.personId.in_({ln.personId for ln in check}), M.CustodyLine.closedDate >= since)
        for ln, other in s.execute(q):
            if (ln.personKind, ln.personId, _line_key(ln)) in keys:
                dup.setdefault((ln.personId, _line_key(ln)),
                               f"{ln.personName} — {ln.itemName} ({custody_no(other)} — {ln.closedDate.strftime('%d/%m/%Y')})")
    if dup:
        return None, None, (f"الإجراء ده اتقفل لنفس الشخص في عهدة تانية خلال آخر {DUP_DAYS} يوم (علشان مايتفوترش مرتين): "
                            + "، ".join(dup.values()))
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
    locked = [f"{invoice_no(i)} ({INVOICE_STATUS.get(i.status, i.status)})" for i in invoices if i.status not in INVOICE_OPEN]
    if locked:                       # اتبعتت / معلّقة / معتمدة / اتحصّلت ← عند الحسابات (المرفوضة بترجع تتصلّح)
        return 0, f"الفواتير دي عند الحسابات: {'، '.join(locked)} — مينفعش التقفيل يتلغي"
    later = s.scalar(select(func.max(M.CustodyLine.closedDate)).where(M.CustodyLine.custodyId == c.id, M.CustodyLine.closedDate > when))
    if later:                        # الدعم الإداري في التقفيلات اللي بعده متحسوب على أساسه
        return 0, f"ألغي التقفيل الأحدث الأول ({later.strftime('%d/%m/%Y')}) — الإلغاء بيبقى للأحدث بس"
    for inv in invoices:
        s.delete(inv)
    n = s.query(M.CustodyLine).filter(M.CustodyLine.custodyId == c.id, M.CustodyLine.closedDate == when) \
        .update({"closedDate": None}, synchronize_session=False)
    if n and c.status == "closed":
        c.status, c.closedDate = "disbursed", None
    return n, None


# ---------------------------------------------------------------------------
# حسابات العهد: حالة الفاتورة (المحاسب — custody.accounts)
# ---------------------------------------------------------------------------
INVOICE_STATUS = {"pending": "بانتظار الحسابات", "sent": "اتبعتت", "hold": "معلّقة", "rejected": "مرفوضة",
                  "approved": "معتمدة", "collected": "اتحصّلت"}
INVOICE_OPEN = ("pending", "rejected")       # التقفيل بتاعها لسه يتلغي (ماتبعتتش، أو اترفضت ولازم تتصلّح)
INVOICE_FINAL = ("approved", "collected")
INVOICE_ACTIONS = {"send": "إرسال", "hold": "تعليق", "reject": "رفض", "release": "رجوع", "approve": "اعتماد",
                   "collect": "تحصيل", "undo": "تراجع"}


def invoice_history(inv):
    try:
        return json.loads(inv.history or "[]")
    except ValueError:
        return []


def invoice_action(inv, action, d, user):
    """تغيير حالة فاتورة ← رسالة خطأ أو None. d = {ref, date, note}.
    send: pending ← sent (مرجع وتاريخ — وعلى المبعوتة: تصحيح المرجع). hold / reject: بسبب، من pending أو sent (والرفض من
    المعلّقة كمان). release: رجوع المعلّقة / المرفوضة لحالتها. approve: sent ← approved. collect: approved ← collected
    (رقم وتاريخ). undo: خطوة لورا (اتحصّلت ← معتمدة ← اتبعتت ← بانتظار الحسابات)."""
    no, today = invoice_no(inv), date.today()
    ref, note = str(d.get("ref") or "").strip(), str(d.get("note") or "").strip()
    when = db.parse_date(d.get("date")) or today
    if d.get("date") and not db.parse_date(d.get("date")):
        return "التاريخ مش صحيح"
    if when > today:
        return "التاريخ لسه ماجاش"
    st, entry = inv.status, {"at": db.now_iso(), "user": user, "action": action}
    if action == "send":
        if st not in ("pending", "sent"):
            return f"{no}: الإرسال للفاتورة اللي بانتظار الحسابات ({INVOICE_STATUS.get(st, st)})"
        if not ref:
            return "رقم المرجع مطلوب"
        if len(ref) > 60:
            return "رقم المرجع طويل (60 حرف بالكتير)"
        if when < inv.closingDate:
            return f"{no}: تاريخ الإرسال قبل تاريخ الفاتورة ({inv.closingDate.strftime('%d/%m/%Y')})"
        inv.status, inv.sentRef, inv.sentDate, inv.sentBy, inv.note, inv.prevStatus = "sent", ref, when, user, None, None
        entry.update(ref=ref, date=when.isoformat())
    elif action in ("hold", "reject"):
        if st not in (("pending", "sent") if action == "hold" else ("pending", "sent", "hold")):
            return f"{no}: الفاتورة {INVOICE_STATUS.get(st, st)} — مينفعش {'تتعلّق' if action == 'hold' else 'تترفض'}"
        if not note:
            return "اكتب السبب"
        if st != "hold":
            inv.prevStatus = st
        inv.status, inv.note = ("hold" if action == "hold" else "rejected"), note
        entry.update(note=note)
    elif action == "release":
        if st not in ("hold", "rejected"):
            return f"{no}: الفاتورة مش معلّقة ولا مرفوضة"
        inv.status = inv.prevStatus if inv.prevStatus in ("pending", "sent") else ("sent" if inv.sentRef else "pending")
        inv.note, inv.prevStatus = None, None
        if note:
            entry.update(note=note)
    elif action == "approve":
        if st != "sent":
            return f"{no}: الاعتماد بعد الإرسال بالمرجع ({INVOICE_STATUS.get(st, st)})"
        if inv.sentDate and when < inv.sentDate:
            return f"{no}: تاريخ الاعتماد قبل تاريخ الإرسال ({inv.sentDate.strftime('%d/%m/%Y')})"
        inv.status, inv.approvedDate, inv.approvedBy = "approved", when, user
        entry.update(date=when.isoformat())
    elif action == "collect":
        if st != "approved":
            return f"{no}: التحصيل بعد الاعتماد ({INVOICE_STATUS.get(st, st)})"
        if not ref:
            return "رقم سند التحصيل مطلوب"
        if len(ref) > 60:
            return "رقم السند طويل (60 حرف بالكتير)"
        if inv.approvedDate and when < inv.approvedDate:
            return f"{no}: تاريخ التحصيل قبل تاريخ الاعتماد ({inv.approvedDate.strftime('%d/%m/%Y')})"
        inv.status, inv.collectedRef, inv.collectedDate, inv.collectedBy = "collected", ref, when, user
        entry.update(ref=ref, date=when.isoformat())
    elif action == "undo":
        if st == "collected":
            inv.status, inv.collectedRef, inv.collectedDate, inv.collectedBy = "approved", None, None, None
        elif st == "approved":
            inv.status, inv.approvedDate, inv.approvedBy = ("sent" if inv.sentRef else "pending"), None, None
        elif st == "sent":
            inv.status, inv.sentRef, inv.sentDate, inv.sentBy = "pending", None, None, None
        else:
            return f"{no}: مفيش خطوة تتراجع عنها ({INVOICE_STATUS.get(st, st)})"
        if note:
            entry.update(note=note)
    else:
        return "إجراء غير معروف"
    entry["status"] = inv.status
    inv.history = json.dumps(invoice_history(inv) + [entry], ensure_ascii=False)
    return None


def employee_cost(s, emp_id):
    """💰 تكلفة معاملات الموظف (بطاقة الموظف): البنود المنفّذة («تم») في كل العهد غير الملغاة — رسوم حكومية بس، من غير
    الدعم الإداري. التاريخ = تاريخ التقفيل (زي لوحة المصروفات)، ولو لسه ماتقفلش ← يوم التنفيذ. والبنود اللي لسه مفتوحة في عهد شغالة بتتحسب «متوقع» بس."""
    lines, pending, pending_n, custs = [], 0.0, 0, {}
    for ln in s.scalars(select(M.CustodyLine).where(M.CustodyLine.personKind == "employee", M.CustodyLine.personId == emp_id)):
        if ln.custodyId not in custs:
            custs[ln.custodyId] = s.get(M.Custody, ln.custodyId)
        c = custs[ln.custodyId]
        if c is None or c.status == "cancelled":
            continue
        if not ln.done:
            pending, pending_n = pending + amount(ln), pending_n + 1
            continue
        when = ln.closedDate or ln.doneDate or c.disbursedDate or c.requestDate
        lines.append({"date": db.ser(when), "custodyId": c.id, "custodyNo": custody_no(c), "txType": c.txType, "item": ln.itemName,
                      "itemEn": ln.itemNameEn, "authority": ln.authority, "amount": amount(ln), "receiptNo": ln.receiptNo,
                      "closed": bool(ln.closedDate)})
    lines.sort(key=lambda x: (x["date"] or "", x["custodyNo"]), reverse=True)
    by_year = {}
    for x in lines:
        y = (x["date"] or "")[:4] or "—"
        by_year[y] = round(by_year.get(y, 0) + x["amount"], 3)
    return {"lines": lines, "total": round(sum(x["amount"] for x in lines), 3), "byYear": by_year,
            "pending": round(pending, 3), "pendingCount": pending_n}


def expenses(s, ctx):
    """لوحة المصروفات الحكومية (custody.expenses): فواتير **كل** العهد (مش عهد المستخدم بس) اللي مركز تكلفتها / شركتها في
    نطاقه، وبنودها المقفولة (للتقسيم بالجهة والبند)، والرصيد اللي لسه مع المستلمين. التجميع والفلاتر في الواجهة."""
    cc_co = db.cost_center_companies(s)
    custs = {c.id: c for c in s.scalars(select(M.Custody))}

    def ok(company, cc):
        return ctx is None or ctx.record_ok(company, cc_co.get(cc), cc)

    invoices, status = [], {}
    for inv in s.scalars(select(M.Invoice).order_by(M.Invoice.closingDate, M.Invoice.ccCode, M.Invoice.no)):
        if not ok(inv.billCompanyId, inv.costCenter):
            continue
        c = custs.get(inv.custodyId)
        invoices.append({"id": inv.id, "number": invoice_no(inv), "custodyId": inv.custodyId, "custodyNo": custody_no(c) if c else "",
                         "txType": c.txType if c else None, "closingDate": db.ser(inv.closingDate), "costCenter": inv.costCenter,
                         "companyId": inv.billCompanyId, "employees": inv.employees, "gov": inv.govAmount, "support": inv.supportAmount,
                         "total": inv.total, "status": inv.status})
        status[(inv.custodyId, inv.closingDate, inv.costCenter or "")] = inv.status
    lines, by_custody = [], {}
    for ln in s.scalars(select(M.CustodyLine)):
        by_custody.setdefault(ln.custodyId, []).append(ln)
        st = status.get((ln.custodyId, ln.closedDate, ln.costCenter or "")) if ln.closedDate else None
        if st is None:
            continue
        c = custs.get(ln.custodyId)
        lines.append({"closingDate": db.ser(ln.closedDate), "costCenter": ln.costCenter, "companyId": cc_co.get(ln.costCenter) or ln.companyId,
                      "authority": ln.authority, "item": ln.itemName, "amount": amount(ln), "txType": c.txType if c else None, "status": st})
    held, carried_by = 0.0, {}                   # اتصرف للمستلمين ولسه ماتنفّذش (العهد المفتوحة اللي فيها حد من نطاقه)
    spent = lambda c: sum(amount(x) for x in by_custody.get(c.id, []) if x.done)   # noqa: E731
    for c in custs.values():
        if c.direct and c.carryToId and c.status != "cancelled":
            carried_by[c.carryToId] = carried_by.get(c.carryToId, 0) + spent(c)
    for c in custs.values():
        ls = by_custody.get(c.id, [])
        if not any(ok(x.companyId, x.costCenter) for x in ls):
            continue
        if c.direct:                             # اتصرف عليه من فلوس عهدة تانية ← بينقّص لحد ما الطلب اللي اتضاف عليه يتصرف
            carrier = custs.get(c.carryToId)
            if c.status in FUNDED and not (carrier is not None and carrier.status in FUNDED):
                held -= spent(c)
        elif c.status == "disbursed":
            held += (c.disbursedAmount or 0) - carried_by.get(c.id, 0) - spent(c)
    return {"invoices": invoices, "lines": lines, "held": round(held, 3)}


def dump(s, ctx):
    """للواجهة: جدول الرسوم والإعدادات والعهد ببنودها وفواتيرها. المستخدم بيشوف عهده بس (وصاحب custody.all الكل)،
    والمحدود بشركات بيشوف العهدة لو فيها حد من نطاقه. custodyBusy = مين في عهد مفتوحة أو اتقفل قريب (من كل المستخدمين)."""
    names = user_names(s)
    lines = {}
    for ln in s.scalars(select(M.CustodyLine).order_by(M.CustodyLine.custodyId, M.CustodyLine.personName,
                                                       M.CustodyLine.personId, M.CustodyLine.position)):
        lines.setdefault(ln.custodyId, []).append(db.to_dict(ln))
    out, visible = [], set()
    every = list(s.scalars(select(M.Custody).order_by(M.Custody.no.desc())))
    by_id = {c.id: c for c in every}
    amt = lambda x: float((x["actual"] if x["actual"] is not None else x["planned"]) or 0)   # noqa: E731
    due = {c.id: round(sum(amt(x) for x in lines.get(c.id, []) if x["done"]), 3) for c in every if c.direct}
    carried_list = {}                                 # الطلب ← التقفيلات المباشرة المضافة عليه
    for c in every:
        if c.direct and c.carryToId and c.status != "cancelled":
            carried_list.setdefault(c.carryToId, []).append({"id": c.id, "number": custody_no(c), "amount": due[c.id]})
    for c in every:
        ls = lines.get(c.id, [])
        if not can_see(ctx, c):
            continue
        if ctx and not ctx.allCompanies and not any(ctx.company_ok(x["companyId"]) for x in ls if x["companyId"]) \
                and not (c.companyId and ctx.company_ok(c.companyId)):
            continue
        d = db.to_dict(c)
        d["lines"], d["number"], d["ownerName"] = ls, custody_no(c), names.get(c.ownerId, "")
        carrier = by_id.get(c.carryToId) if c.carryToId else None
        d["dueAmount"] = due.get(c.id) if c.direct else None                 # مبلغ التقفيل المباشر
        d["carryToNumber"] = custody_no(carrier) if carrier is not None else ""
        d["carryFunded"] = bool(carrier is not None and carrier.status in FUNDED)    # الطلب اللي اتضاف عليه اتصرف
        d["carried"] = carried_list.get(c.id, [])                               # التقفيلات المباشرة المضافة على الطلب ده
        d["carriedAmount"] = round(sum(x["amount"] for x in d["carried"]), 3)
        out.append(d)
        visible.add(c.id)
    invoices = []
    for inv in s.scalars(select(M.Invoice).order_by(M.Invoice.createdAt.desc(), M.Invoice.ccCode, M.Invoice.no.desc())):
        if inv.custodyId in visible:
            d = db.to_dict(inv)
            d["number"], d["history"] = invoice_no(inv), invoice_history(inv)
            invoices.append(d)
    see_all = sees_all(ctx)
    return {
        "custodies": out,
        "invoices": invoices,
        "custodySettings": settings(s),
        "custodyBusy": busy(s),
        "custodyUsers": [{"id": u.id, "name": u.displayName or u.username, "code": u.custodyCode}
                         for u in s.scalars(select(M.User).order_by(M.User.id))] if see_all else [],
        "feeItems": [db.to_dict(f) for f in s.scalars(select(M.FeeItem).order_by(M.FeeItem.txType, M.FeeItem.position))],
    }
