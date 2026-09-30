"""تقفيل المعاملة بيحدّث بيانات الموظف: البند بيجدد تاريخ، والانتهاء الجديد بيتسجّل عليه

- fee_items.updates_field: التاريخ اللي البند بيجدده في بيانات الموظف (residencyExp / workPermitExp / healthCardExp).
  الافتراضي للأنواع اللي على الموظفين (تجديد إقامة، تحويل إقامة من الداخل، تجديد إذن عمل وطني): بند مرحلة
  «الإقامة» ← الإقامة، بند مرحلة «إذن العمل» ← إذن العمل، وبند كارت / البطاقة الصحية ← البطاقة الصحية.
- custody_lines: updates_field (نسخة من البند وقت الطلب)، old_expiry (التاريخ وقت الطلب)، new_expiry (اللي اتسجّل).
  البنود الموجودة بتاخد updates_field من بندها في الجدول (old_expiry فاضي — مش معروف).

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EMPLOYEE_TYPES = ("renewal", "transfer_in", "kw_permit_renewal")


def upgrade() -> None:
    with op.batch_alter_table("fee_items") as batch:
        batch.add_column(sa.Column("updates_field", sa.String(length=30), nullable=True))
    with op.batch_alter_table("custody_lines") as batch:
        batch.add_column(sa.Column("updates_field", sa.String(length=30), nullable=True))
        batch.add_column(sa.Column("old_expiry", sa.Date(), nullable=True))
        batch.add_column(sa.Column("new_expiry", sa.Date(), nullable=True))
    conn = op.get_bind()
    types = ", ".join(f"'{t}'" for t in EMPLOYEE_TYPES)
    conn.execute(sa.text(f"UPDATE fee_items SET updates_field = 'residencyExp' WHERE tx_type IN ('renewal', 'transfer_in') AND stage = 'residency'"))
    conn.execute(sa.text(f"UPDATE fee_items SET updates_field = 'workPermitExp' WHERE tx_type IN ({types}) AND stage = 'awaiting_work_permit'"))
    conn.execute(sa.text(f"UPDATE fee_items SET updates_field = 'healthCardExp' WHERE tx_type IN ({types}) AND updates_field IS NULL "
                         "AND (name LIKE '%كارت الصحة%' OR name LIKE '%البطاقة الصحية%' OR name LIKE '%كارت صحي%')"))
    conn.execute(sa.text("UPDATE custody_lines SET updates_field = (SELECT f.updates_field FROM fee_items f WHERE f.id = custody_lines.fee_item_id) "
                         "WHERE person_kind = 'employee' AND fee_item_id IS NOT NULL"))


def downgrade() -> None:
    with op.batch_alter_table("custody_lines") as batch:
        batch.drop_column("new_expiry")
        batch.drop_column("old_expiry")
        batch.drop_column("updates_field")
    with op.batch_alter_table("fee_items") as batch:
        batch.drop_column("updates_field")
