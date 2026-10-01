"""حسابات العهد: المحاسب بيتابع الفواتير — إرسال بالمرجع، تعليق / رفض بسبب، اعتماد، تحصيل

- invoices.sent_ref / sent_date / sent_by: رقم المرجع اللي اتبعتت بيه الفاتورة (للوكيل أو شركة مركز التكلفة) وتاريخه.
- invoices.note: سبب التعليق أو الرفض الحالي. prev_status: الحالة قبل التعليق / الرفض (علشان «رجوع»).
- invoices.collected_ref / collected_date / collected_by: رقم سند التحصيل وتاريخه.
- invoices.history: سجل تغييرات الحالة (JSON) — مين، إمتى، المرجع والسبب.
- دور «محاسب» بياخد: عرض العهد، حسابات العهد (custody.accounts)، ولوحة المصروفات.

Revision ID: 0035
Revises: 0034
Create Date: 2026-10-01

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0035"
down_revision: Union[str, None] = "0034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEYS = ["custody.view", "custody.accounts", "custody.expenses"]
COLS = ("sent_ref", "sent_date", "sent_by", "note", "prev_status", "collected_ref", "collected_date", "collected_by", "history")


def _edit_accountant(fn):
    conn = op.get_bind()
    for rid, perms in conn.execute(sa.text("SELECT id, permissions FROM roles WHERE id = 'accountant'")).all():
        conn.execute(sa.text("UPDATE roles SET permissions = :p WHERE id = :i"),
                     {"p": json.dumps(fn(json.loads(perms or "[]"))), "i": rid})


def upgrade() -> None:
    with op.batch_alter_table("invoices") as batch:
        batch.add_column(sa.Column("sent_ref", sa.Unicode(length=60), nullable=True))
        batch.add_column(sa.Column("sent_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("sent_by", sa.Unicode(length=300), nullable=True))
        batch.add_column(sa.Column("note", sa.UnicodeText(), nullable=True))
        batch.add_column(sa.Column("prev_status", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("collected_ref", sa.Unicode(length=60), nullable=True))
        batch.add_column(sa.Column("collected_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("collected_by", sa.Unicode(length=300), nullable=True))
        batch.add_column(sa.Column("history", sa.UnicodeText(), nullable=True))
        batch.create_index("ix_invoices_sent_ref", ["sent_ref"])
    _edit_accountant(lambda keys: keys + [k for k in KEYS if k not in keys])


def downgrade() -> None:
    _edit_accountant(lambda keys: [k for k in keys if k not in KEYS])
    op.execute("UPDATE invoices SET status = 'approved' WHERE status = 'collected'")
    op.execute("UPDATE invoices SET status = 'pending' WHERE status NOT IN ('pending', 'approved')")
    with op.batch_alter_table("invoices") as batch:
        batch.drop_index("ix_invoices_sent_ref")
        for c in reversed(COLS):
            batch.drop_column(c)
