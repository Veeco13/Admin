# -*- coding: utf-8 -*-
"""
Lunx — تاريخ الموظف: تحركاته بين الشركات والمشاريع ومراكز التكلفة.

كل تغيير في الشركة المسجّل عليها الموظف (الانتماءات) أو مركز التكلفة بيتسجل:
- في الخط الزمني للموظف (employee_timeline) بأسماء واضحة «من … إلى …».
- في السجل التاريخي للشركتين (company_history): خروج من القديمة وانضمام للجديدة.
والسطور دي بترجع للي نادى الدالة عشان تدخل في سجل التدقيق.
"""
from sqlalchemy import select

import db
import models as M

# أنواع الخط الزمني اللي بتظهر في تبويب «التحركات»
MOVE_TYPES = ("baseline", "create", "transfer", "project", "cost_center", "import_add")

GOV_STAGE_LABELS = {
    "awaiting_contract": "بانتظار عقد العمل", "awaiting_work_permit": "بانتظار إذن العمل",
    "health_insurance": "التأمين الصحي", "residency": "الإقامة", "civil_id": "البطاقة المدنية",
    "renewed": "تم التجديد", "awaiting_cancellation": "بانتظار إلغاء الإقامة وإذن العمل",
    # مسار «إنهاء خدمة — عمالة وطنية» (app.KW_END_STAGES): المرحلة = الخطوة الشغالة دلوقتي
    "kw_end_form": "إنهاء خدمة: طباعة استمارة 103 والتوقيع عليها", "kw_end_pifss": "إنهاء خدمة: إلغاء الاشتراك في التأمينات الاجتماعية",
    "kw_end_permit": "إنهاء خدمة: إلغاء إذن العمل", "kw_end_done": "إنهاء خدمة: اكتملت الإجراءات",
}
EMP_STATUS_LABELS = {"active": "في الخدمة", "warning": "في فترة الإنذار", "resigned": "مستقيل", "terminated": "إنهاء خدمات",
                     "pending_completion": "قيد الاستكمال"}


MARITAL_LABELS = {"single": "أعزب", "married": "متزوج", "divorced": "مطلق", "widowed": "أرمل"}


def value_label(field, value):
    """قيمة حقل للعرض في السجل (بدل الكود الداخلي)."""
    if field == "maritalStatus":
        return MARITAL_LABELS.get(value, value)
    if field == "govStage":
        return GOV_STAGE_LABELS.get(value, value)
    if field == "employmentStatus":
        return EMP_STATUS_LABELS.get(value, value)
    return value


def _company(s, cid):
    c = s.get(M.Company, cid) if cid else None
    return c.nameAr if c else None


def _project(s, pid):
    p = s.get(M.Project, pid) if pid else None
    return p.nameAr if p else None


def aff_text(s, a):
    """«الشركة» (مشروع: …)"""
    if not a or not (a.get("companyId") or a.get("projectId")):
        return "—"
    co = _company(s, a.get("companyId")) or "—"
    pr = _project(s, a.get("projectId"))
    return f"«{co}»" + (f" (مشروع: {pr})" if pr else "")


def cc_text(s, cc):
    if not cc:
        return "—"
    co = _company(s, db.cost_center_company(s, cc))
    return f"«{cc}»" + (f" (شغال فعليًا في: {co})" if co else "")


def current_state_text(s, affs, cc):
    """الوضع الحالي: مسجّل على … · مركز التكلفة …"""
    parts = [f"مسجّل على {aff_text(s, affs[0])}" if affs else "مش مسجّل على شركة"]
    if len(affs) > 1:
        parts.append("شركات إضافية: " + "، ".join(aff_text(s, a) for a in affs[1:]))
    parts.append(f"مركز التكلفة {cc_text(s, cc)}")
    return " · ".join(parts)


def _key(a):
    return (a.get("companyId") or None, a.get("projectId") or None)


def record_moves(s, emp_id, emp_name, old_affs, new_affs, old_cc, new_cc, user, source=""):
    """يسجّل تحركات الموظف ويرجّع السطور (للتدقيق). old/new_affs: [{companyId, projectId}] الأول = الأساسي."""
    old_affs = [a for a in (old_affs or []) if a.get("companyId") or a.get("projectId")]
    new_affs = [a for a in (new_affs or []) if a.get("companyId") or a.get("projectId")]
    suffix = f" ({source})" if source else ""
    lines = []
    op = old_affs[0] if old_affs else None
    np_ = new_affs[0] if new_affs else None

    # الشركة الأساسية
    if (op and op.get("companyId")) != (np_ and np_.get("companyId")):
        lines.append(("transfer", f"انتقال: من {aff_text(s, op)} إلى {aff_text(s, np_)}{suffix}"))
    elif op and np_ and op.get("projectId") != np_.get("projectId"):
        lines.append(("project", f"تغيير المشروع في «{_company(s, np_.get('companyId')) or '—'}»: "
                                 f"من {_project(s, op.get('projectId')) or 'بدون مشروع'} إلى {_project(s, np_.get('projectId')) or 'بدون مشروع'}{suffix}"))
    # الشركات الإضافية
    old_rest = {_key(a) for a in old_affs[1:]} | ({_key(op)} if op else set())
    new_rest = {_key(a) for a in new_affs[1:]} | ({_key(np_)} if np_ else set())
    for a in new_affs[1:]:
        if _key(a) not in old_rest:
            lines.append(("transfer", f"إضافة شركة إضافية: {aff_text(s, a)}{suffix}"))
    for a in old_affs[1:]:
        if _key(a) not in new_rest:
            lines.append(("transfer", f"إزالة شركة إضافية: {aff_text(s, a)}{suffix}"))
    # مركز التكلفة
    if (old_cc or None) != (new_cc or None):
        lines.append(("cost_center", f"مركز التكلفة: من {cc_text(s, old_cc)} إلى {cc_text(s, new_cc)}{suffix}"))

    for typ, label in lines:
        db.push_timeline(s, emp_id, typ, label, user)

    # سجل الشركات: خروج/انضمام (الشركة المسجّل عليها + الشركة الفعلية من مركز التكلفة)
    old_cos = {a.get("companyId") for a in old_affs if a.get("companyId")}
    new_cos = {a.get("companyId") for a in new_affs if a.get("companyId")}
    who = f"{emp_name} ({emp_id})"
    for cid in old_cos - new_cos:
        db.log_company_history(s, cid, "employee_left", f"خروج الموظف {who}" + (f" — إلى {aff_text(s, np_)}" if np_ else ""), user)
    for cid in new_cos - old_cos:
        db.log_company_history(s, cid, "employee_joined", f"انضمام الموظف {who}" + (f" — من {aff_text(s, op)}" if op else ""), user)
    old_real, new_real = db.cost_center_company(s, old_cc), db.cost_center_company(s, new_cc)
    if old_real != new_real:
        if old_real and old_real not in new_cos:
            db.log_company_history(s, old_real, "employee_left", f"الموظف {who} ساب مركز التكلفة «{old_cc}»", user)
        if new_real and new_real not in old_cos | new_cos:
            db.log_company_history(s, new_real, "employee_joined", f"الموظف {who} اشتغل فعليًا في الشركة (مركز التكلفة «{new_cc}»)", user)
    return [label for _, label in lines]


def baseline_all(s, user="النظام"):
    """سطر «بداية تسجيل التحركات» لكل موظف مالوش سطر تحركات — بوضعه الحالي. بيرجّع العدد."""
    has = set(s.scalars(select(M.EmployeeTimeline.employeeId).where(M.EmployeeTimeline.type.in_(MOVE_TYPES))))
    n = 0
    for e in s.scalars(select(M.Employee)):
        if e.id in has:
            continue
        db.push_timeline(s, e.id, "baseline",
                         "بداية تسجيل التحركات — " + current_state_text(s, db.get_affiliations(s, e.id), e.costCenter), user)
        n += 1
    return n
