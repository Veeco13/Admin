"""approval_requests — ✋ الموافقة على التعديلات الحساسة

تعديل المرتب / البنك / إنهاء الخدمة / حذف موظف من مستخدم مالوش صلاحية «الموافقة على التعديلات الحساسة» بيتحفظ
هنا كطلب (القيمة القديمة والجديدة) ومابيتطبّقش غير لما حد معاه الصلاحية يوافق.

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "approval_requests",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("employee_id", sa.String(length=64), nullable=False),
        sa.Column("employee_name", sa.Unicode(length=300), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("changes", sa.UnicodeText(), nullable=True),
        sa.Column("note", sa.UnicodeText(), nullable=True),
        sa.Column("source", sa.Unicode(length=300), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("requested_by", sa.Unicode(length=300), nullable=True),
        sa.Column("requested_by_id", sa.String(length=64), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by", sa.Unicode(length=300), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decision_note", sa.UnicodeText(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_approval_requests")),
    )
    op.create_index(op.f("ix_approval_requests_employee_id"), "approval_requests", ["employee_id"])
    op.create_index(op.f("ix_approval_requests_status"), "approval_requests", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_approval_requests_status"), table_name="approval_requests")
    op.drop_index(op.f("ix_approval_requests_employee_id"), table_name="approval_requests")
    op.drop_table("approval_requests")
