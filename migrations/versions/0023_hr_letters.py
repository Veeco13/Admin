"""hr letters — الخطابات والشهادات: شهادة راتب / استمرارية راتب / طلب إجازة

- hr_letters: كل خطاب برقمه (series + year + no فريد: HR-SCR-2026-0001 للشهادات، LV-2026-0001 للإجازة) ونسخة من
  بياناته وقت الإصدار (data — JSON) عشان إعادة الطباعة تطلع نفس الخطاب. طلب الإجازة بحالته (مقدَّم / معتمد / مرفوض)
  وتواريخه وعدد أيامه — جاهزة لمرحلة الإجازات بعدين.

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "hr_letters",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("series", sa.String(length=10), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("no", sa.Integer(), nullable=False),
        sa.Column("number", sa.Unicode(length=120), nullable=False),
        sa.Column("employee_id", sa.String(length=64), nullable=True),
        sa.Column("company_id", sa.String(length=64), nullable=True),
        sa.Column("data", sa.UnicodeText(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("date_from", sa.Date(), nullable=True),
        sa.Column("date_to", sa.Date(), nullable=True),
        sa.Column("days", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Unicode(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by", sa.Unicode(length=300), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name=op.f("fk_hr_letters_employee_id_employees")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name=op.f("fk_hr_letters_company_id_companies")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hr_letters")),
        sa.UniqueConstraint("number", name=op.f("uq_hr_letters_number")),
        sa.UniqueConstraint("series", "year", "no", name=op.f("uq_hr_letters_series_year_no")),
    )
    op.create_index(op.f("ix_hr_letters_employee_id"), "hr_letters", ["employee_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_hr_letters_employee_id"), table_name="hr_letters")
    op.drop_table("hr_letters")
