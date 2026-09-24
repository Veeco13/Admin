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

    def __init__(self, user, role, company_ids):
        self.id = user.id
        self.username = user.username
        self.display = user.displayName or user.username
        self.roleId = role.id if role else None
        self.roleName = role.name if role else None
        self.isAdmin = bool(role and role.isAdmin)
        self.perms = set(ALL_KEYS) if self.isAdmin else set(load_keys(role) if role else [])
        self.allCompanies = self.isAdmin or bool(user.allCompanies)
        self.companies = set(company_ids)

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

    # --- نطاق الشركات ---
    def company_ok(self, company_id):
        return self.allCompanies or (company_id in self.companies)

    def affs_ok(self, affs):
        """الموظف في النطاق لو أي انتماء ليه في شركة مسموحة."""
        if self.allCompanies:
            return True
        return any(a.get("companyId") in self.companies for a in (affs or []))

    def to_api(self):
        return {
            "id": self.id, "username": self.username, "displayName": self.display,
            "roleId": self.roleId, "roleName": self.roleName, "isAdmin": self.isAdmin,
            "perms": sorted(self.perms, key=ALL_KEYS.index),
            "allCompanies": self.allCompanies, "companies": sorted(self.companies),
            "hiddenFields": {"employee": self.denied_fields("employee"),
                             "candidate": self.denied_fields("candidate")},
            # توافق مع الواجهة القديمة
            "role": "admin" if self.isAdmin else "user",
            "readOnly": not any(k.endswith((".edit", ".delete")) for k in self.perms),
        }


def load_ctx(s, uid):
    u = s.get(M.User, uid) if uid else None
    if not u or not u.active:
        return None
    role = s.get(M.Role, u.roleId) if u.roleId else None
    cids = s.scalars(select(M.UserCompany.companyId).where(M.UserCompany.userId == u.id)).all()
    return UserCtx(u, role, cids)
