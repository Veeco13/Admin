"""service end — الحالة الوظيفية: مستقيل / إنهاء خدمات وفترة الإنذار

- employees.service_end_type: نوع انتهاء الخدمة (resigned مستقيل | terminated إنهاء خدمات). مع «في فترة الإنذار»
  هو الحالة اللي الموظف بيتحوّل لها لوحده بعد service_end_date.
- employees.service_end_reason: سبب انتهاء الخدمة (زي استمارة 103: استقالة، إنهاء خدمات من صاحب العمل، انتهاء العقد…).
- الحالات «منتهي خدمته» القديمة (terminated) بقى اسمها «إنهاء خدمات» — نفس الكود، ونوعها بيتعبّى terminated.

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("service_end_type", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("service_end_reason", sa.Unicode(length=300), nullable=True))
    op.execute(sa.text("UPDATE employees SET service_end_type = 'terminated' WHERE employment_status = 'terminated'"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE employees SET employment_status = 'terminated' WHERE employment_status = 'resigned'"))
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("service_end_reason")
        batch.drop_column("service_end_type")
