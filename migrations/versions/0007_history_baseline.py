"""history baseline — بداية تسجيل تحركات الموظفين

قبل كده نقل الموظف بين الشركات/المشاريع مكانش بيتسجل. من 0007 كل نقلة بتتسجل (history.py)،
والترحيل ده بيحط لكل موظف سطر «بداية تسجيل التحركات» بوضعه الحالي عشان أول نقلة تبان «من فين لفين».
وكمان بيصلّح السطور القديمة اللي اتكتبت بكود المرحلة/الحالة بدل اسمها.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-27

"""
import uuid
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MOVE_TYPES = ("baseline", "create", "transfer", "project", "cost_center", "import_add")
CODES = {
    "awaiting_contract": "بانتظار عقد العمل", "awaiting_work_permit": "بانتظار إذن العمل",
    "health_insurance": "التأمين الصحي", "residency": "الإقامة", "civil_id": "البطاقة المدنية",
    "renewed": "تم التجديد", "awaiting_cancellation": "بانتظار إلغاء الإقامة وإذن العمل",
    "active": "في الخدمة", "warning": "في فترة الإنذار", "terminated": "منتهي خدمته",
    "pending_completion": "قيد الاستكمال",
}


def upgrade() -> None:
    conn = op.get_bind()
    q = lambda sql, **kw: conn.execute(sa.text(sql), kw).all()
    companies = dict(q("SELECT id, name_ar FROM companies"))
    projects = dict(q("SELECT id, name_ar FROM projects"))
    cc_company = dict(q("SELECT name, company_id FROM cost_centers"))
    affs = {}
    for emp, cid, pid in q("SELECT employee_id, company_id, project_id FROM employee_affiliations ORDER BY employee_id, position"):
        affs.setdefault(emp, []).append((cid, pid))
    placeholders = ", ".join(f"'{t}'" for t in MOVE_TYPES)
    has = {r[0] for r in q(f"SELECT DISTINCT employee_id FROM employee_timeline WHERE type IN ({placeholders})")}

    def aff_text(a):
        cid, pid = a
        return f"«{companies.get(cid, '—')}»" + (f" (مشروع: {projects[pid]})" if pid in projects else "")

    now = datetime.now().replace(microsecond=0)
    rows = []
    for emp_id, cc in q("SELECT id, cost_center FROM employees"):
        if emp_id in has:
            continue
        a = affs.get(emp_id, [])
        parts = [f"مسجّل على {aff_text(a[0])}" if a else "مش مسجّل على شركة"]
        if len(a) > 1:
            parts.append("شركات إضافية: " + "، ".join(aff_text(x) for x in a[1:]))
        real = companies.get(cc_company.get(cc)) if cc else None
        parts.append(f"مركز التكلفة «{cc}»" + (f" (شغال فعليًا في: {real})" if real else "") if cc else "مركز التكلفة —")
        rows.append({"id": f"tl_{uuid.uuid4().hex[:10]}", "employee_id": emp_id, "type": "baseline",
                     "label": "بداية تسجيل التحركات — " + " · ".join(parts), "date": now, "user": "النظام"})
    if rows:   # op.bulk_insert بيقفّل اسم العمود user صح على كل أنواع القواعد
        tl = sa.table("employee_timeline", sa.column("id", sa.String), sa.column("employee_id", sa.String),
                      sa.column("type", sa.String), sa.column("label", sa.UnicodeText), sa.column("date", sa.DateTime),
                      sa.column("user", sa.Unicode))
        op.bulk_insert(tl, rows)

    # السطور القديمة اللي اتكتبت بالكود الداخلي
    for tid, label in q("SELECT id, label FROM employee_timeline WHERE type IN ('gov_stage', 'edit')"):
        new = label
        for code, ar in CODES.items():
            new = new.replace(f": {code}", f": {ar}").replace(f"{code} ←", f"{ar} ←").replace(f"← {code}", f"← {ar}")
        if new != label:
            conn.execute(sa.text("UPDATE employee_timeline SET label = :l WHERE id = :i"), {"l": new, "i": tid})


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM employee_timeline WHERE type = 'baseline'"))
