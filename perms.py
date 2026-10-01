# -*- coding: utf-8 -*-
"""
Lunx — الأدوار والصلاحيات

كل مستخدم ليه دور (roles) والدور فيه قائمة مفاتيح صلاحيات. مفتاح الصلاحية = "<القسم>.<العملية>".
- الأقسام: عرض / إضافة وتعديل / حذف لكل شاشة.
- البيانات الحساسة: sensitive.* ← من غيرها الحقول دي مابتوصلش للمتصفح أصلًا، ومابتتعدّلش.
- النظام: الاستيراد والنسخ الاحتياطي.
- الدور اللي is_admin = كل الصلاحيات وكل الشركات وإدارة المستخدمين والاستعادة.

نطاق الشركات: لو users.all_companies = False، المستخدم يشوف ويعدّل بس الشركات اللي في user_companies
(وموظفينها وسياراتها ومترشّحينها). السيرفر هو اللي بيفرض ده، مش الواجهة.
"""
import json

from sqlalchemy import select

import models as M

# (القسم، الاسم، العمليات)
MODULES = [
    ("employees", "الإقامات والموظفين", ("view", "edit", "delete")),
    ("companies", "الشركات والمشاريع والمفوّضين", ("view", "edit", "delete")),
    ("vehicles", "السيارات", ("view", "edit", "delete")),
    ("costcenters", "مراكز التكلفة", ("view", "edit", "delete")),
    ("recruitment", "الاستقدام والتوظيف", ("view", "edit", "delete")),
    ("contract", "عقود العمل والقوالب", ("view", "edit")),
    ("custody", "العهد والمصروفات", ("view", "edit", "delete")),
    ("permits", "التصاريح (للموظفين والسيارات)", ("view", "edit", "delete")),
    ("companylog", "السجل التاريخي والتدقيق", ("view",)),
]
ACTION_LABELS = {"view": "عرض", "edit": "إضافة وتعديل", "delete": "حذف"}

# الحقول الحساسة لكل نوع سجل
SENSITIVE = [
    ("sensitive.salary", "المرتب وبدل السكن وتكلفة المعاملات",
     {"employee": ("salary", "housingAmount", "govTransactionCost"), "candidate": ("salary",)}),
    ("sensitive.bank", "البنك والـ IBAN", {"employee": ("bank", "iban")}),
    ("sensitive.documents", "رقم الجواز والمرفقات", {"employee": ("passportNo",), "candidate": ("passportNo",)}),
]

SYSTEM = [
    ("system.import", "استيراد الموظفين من Excel/CSV"),
    ("system.backup", "تنزيل نسخة احتياطية كاملة"),
    ("contract.sign", "توقيعات المفوّضين والموظفين"),
    ("custody.fees", "تعديل جدول رسوم المعاملات"),
    ("custody.direct", "تقفيل عهدة مباشر (إجراء اتصرف عليه من غير طلب — مبلغه بيتضاف على أقرب طلب)"),
    # المحاسب: بيشوف عهد وفواتير الكل (من غير تعديل العهد)، وهو بس اللي بيغيّر حالة الفاتورة
    ("custody.accounts", "حسابات العهد: متابعة فواتير كل العهد (إرسال بالمرجع، تعليق، رفض، اعتماد، تحصيل)"),
    ("custody.all", "عرض عهد كل المستخدمين"),                  # من غيرها المستخدم بيشوف العهد اللي طلبها بس
    ("custody.expenses", "لوحة المصروفات الحكومية (فواتير كل العهد في نطاق شركاته)"),
    # من غيرها تعديل المرتب / البنك / إنهاء الخدمة / حذف موظف بيروح طلب موافقة (approvals.py)
    ("approvals.approve", "الموافقة على التعديلات الحساسة (المرتب، إنهاء الخدمة، حذف موظف، البنك) — وتعديلاته بتتطبّق على طول"),
]

ALL_KEYS = ([f"{m}.{a}" for m, _, acts in MODULES for a in acts]
            + [k for k, _, _ in SENSITIVE] + [k for k, _ in SYSTEM])


def catalog():
    """للواجهة (شاشة تعديل الأدوار)."""
    return {
        "modules": [{"key": m, "label": lab, "actions": list(acts)} for m, lab, acts in MODULES],
        "actionLabels": ACTION_LABELS,
        "sensitive": [{"key": k, "label": lab} for k, lab, _ in SENSITIVE],
        "system": [{"key": k, "label": lab} for k, lab in SYSTEM],
    }


def clean_keys(keys):
    """يشيل أي مفتاح مش معروف، ويضيف «عرض» تلقائيًا لأي قسم فيه تعديل أو حذف."""
    keys = {k for k in (keys or []) if k in ALL_KEYS}
    for k in list(keys):
        mod, act = k.split(".", 1)
        if act in ("edit", "delete") and f"{mod}.view" in ALL_KEYS:
            keys.add(f"{mod}.view")
    return sorted(keys, key=ALL_KEYS.index)


def load_keys(role):
    try:
        return clean_keys(json.loads(role.permissions or "[]"))
    except (ValueError, TypeError):
        return []


class UserCtx:
    """المستخدم الحالي بصلاحياته ونطاقه — بيتحسب مرة في كل طلب."""

    def __init__(self, user, role, company_ids, cost_center_names=()):
        self.id = user.id
        self.username = user.username
        self.display = user.displayName or user.username
        self.jobTitle = user.jobTitle
        self.roleId = role.id if role else None
        self.roleName = role.name if role else None
        self.isAdmin = bool(role and role.isAdmin)
        self.perms = set(ALL_KEYS) if self.isAdmin else set(load_keys(role) if role else [])
        self.allCompanies = self.isAdmin or bool(user.allCompanies)
        self.companies = set(company_ids)
        self.costCenters = set(cost_center_names)    # أسماء (الموظفين مربوطين بالمركز بالاسم)
        self.permitParts = None if self.isAdmin else parse_parts(getattr(user, "permitParts", None))   # None = كل الأجزاء

    # --- الصلاحيات ---
    def can(self, key):
        return self.isAdmin or key in self.perms

    def denied_fields(self, kind):
        """الحقول الحساسة الممنوعة على المستخدم لنوع سجل (employee / candidate)."""
        out = []
        for key, _, fields in SENSITIVE:
            if not self.can(key):
                out += fields.get(kind, ())
        return out

    def strip(self, kind, d):
        """يشيل الحقول الممنوعة من سجل (للعرض) أو من بيانات جاية (للتعديل) — نفس الدالة للاتجاهين."""
        if d:
            for f in self.denied_fields(kind):
                d.pop(f, None)
        return d

    # --- أجزاء التصاريح (القسم 24.2) ---
    @property
    def allParts(self):
        return self.permitParts is None

    def part_ok(self, key):
        """الجزء في نطاقه؟ (التصريح اللي مالوش جزء — من غير عقد — لصاحب «كل الأجزاء» بس)."""
        return self.permitParts is None or (bool(key) and key in self.permitParts)

    # --- نطاق الشركات ---
    def company_ok(self, company_id):
        return self.allCompanies or (company_id in self.companies)

    def affs_ok(self, affs, cc_company=None, cc_name=None):
        """الموظف في النطاق لو أي انتماء ليه (الشركة المسجّل عليها) في شركة مسموحة،
        أو مركز التكلفة بتاعه تابع لشركة مسموحة (شغال فيها فعلًا وهو مسجّل على شركة تانية)،
        أو مركز التكلفة نفسه في نطاق المستخدم (مركز من غير شركة مسجّلة)."""
        if self.allCompanies:
            return True
        return cc_company in self.companies or (bool(cc_name) and cc_name in self.costCenters)             or any(a.get("companyId") in self.companies for a in (affs or []))

    def record_ok(self, company_id, cc_company=None, cc_name=None):
        """مترشّح/سجل ليه شركة واحدة + مركز تكلفة. من غير الاتنين = للنطاق الكامل بس."""
        return self.allCompanies or company_id in self.companies or cc_company in self.companies             or (bool(cc_name) and cc_name in self.costCenters)

    def merge_affs(self, sent, existing):
        """الانتماءات لشركات برّه النطاق (زي الشركة المسجّل عليها موظف ظاهر عن طريق مركز التكلفة)
        مابتتشالش ولا بتتغيّر من المستخدم المحدود — بتفضل زي ما هي، والأساسي يفضل أساسي."""
        if self.allCompanies:
            return list(sent or [])
        locked = [a for a in existing if a.get("companyId") and a["companyId"] not in self.companies]
        mine = [{"companyId": a.get("companyId") or None, "projectId": a.get("projectId") or None}
                for a in (sent or []) if not a.get("companyId") or a["companyId"] in self.companies]
        if locked and existing and existing[0] is locked[0]:
            return [locked[0]] + mine + locked[1:]
        return mine + locked

    def to_api(self):
        """للواجهة. تفاصيل الدور والنطاق لمدير النظام بس — الباقي بياخد المفاتيح اللي بتخفي/بتظهر الأزرار."""
        admin_only = {"roleId": self.roleId, "roleName": self.roleName, "companies": sorted(self.companies)} if self.isAdmin else {}
        return {
            "id": self.id, "username": self.username, "displayName": self.display, "jobTitle": self.jobTitle,
            "isAdmin": self.isAdmin, **admin_only,
            "perms": sorted(self.perms, key=ALL_KEYS.index),
            "allCompanies": self.allCompanies,
            "permitPartsAll": self.allParts, "permitParts": None if self.allParts else sorted(self.permitParts),
            "hiddenFields": {"employee": self.denied_fields("employee"),
                             "candidate": self.denied_fields("candidate")},
            # توافق مع الواجهة القديمة
            "role": "admin" if self.isAdmin else "user",
            "readOnly": not any(k.endswith((".edit", ".delete")) for k in self.perms),
        }


def parse_parts(text):
    """users.permit_parts ← مجموعة مفاتيح الأجزاء، أو None لو فاضي (= كل الأجزاء)."""
    try:
        v = json.loads(text) if text else None
    except ValueError:
        v = None
    keys = {str(k) for k in v if str(k).startswith(("ag:", "co:"))} if isinstance(v, list) else set()
    return keys or None


def load_ctx(s, uid):
    u = s.get(M.User, uid) if uid else None
    if not u or not u.active:
        return None
    role = s.get(M.Role, u.roleId) if u.roleId else None
    cids = s.scalars(select(M.UserCompany.companyId).where(M.UserCompany.userId == u.id)).all()
    ccs = s.scalars(select(M.CostCenter.name).join(M.UserCostCenter, M.UserCostCenter.costCenterId == M.CostCenter.id)
                    .where(M.UserCostCenter.userId == u.id)).all()
    return UserCtx(u, role, cids, ccs)
