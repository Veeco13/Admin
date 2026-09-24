"""foreign keys — ربط الجداول بمفاتيح أجنبية (NO ACTION) بعد تنظيف أي مراجع يتيمة

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (الجدول, العمود, الجدول المرجعي, يقبل NULL؟)
FKS = [
    ("projects", "company_id", "companies", True),
    ("signatories", "company_id", "companies", False),
    ("company_docs", "company_id", "companies", False),
    ("vehicles", "company_id", "companies", True),
    ("vehicles", "driver_id", "employees", True),
    ("candidates", "target_company_id", "companies", True),
    ("employee_affiliations", "employee_id", "employees", False),
    ("employee_affiliations", "company_id", "companies", True),
    ("employee_affiliations", "project_id", "projects", True),
]


def _clean_orphans():
    """قبل إضافة القيود: المرجع اليتيم يتفضّى لو العمود بيقبل NULL، ويتحذف الصف لو لأ."""
    for table, col, ref, nullable in FKS:
        cond = f"{col} IS NOT NULL AND {col} NOT IN (SELECT id FROM {ref})"
        if nullable:
            op.execute(sa.text(f"UPDATE {table} SET {col} = NULL WHERE {cond}"))
        else:
            op.execute(sa.text(f"DELETE FROM {table} WHERE {cond}"))
    # انتماء بدون شركة ولا مشروع ملوش معنى
    op.execute(sa.text("DELETE FROM employee_affiliations WHERE company_id IS NULL AND project_id IS NULL"))


def upgrade() -> None:
    _clean_orphans()
    tables = {}
    for table, col, ref, _ in FKS:
        tables.setdefault(table, []).append((col, ref))
    for table, cols in tables.items():
        with op.batch_alter_table(table) as batch:
            for col, ref in cols:
                batch.create_foreign_key(f"fk_{table}_{col}_{ref}", ref, [col], ["id"])


def downgrade() -> None:
    tables = {}
    for table, col, ref, _ in FKS:
        tables.setdefault(table, []).append((col, ref))
    for table, cols in tables.items():
        with op.batch_alter_table(table) as batch:
            for col, ref in cols:
                batch.drop_constraint(f"fk_{table}_{col}_{ref}", type_="foreignkey")
