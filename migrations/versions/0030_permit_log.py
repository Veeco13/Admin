"""بطاقة التصاريح: سجل التصاريح لكل صاحب تصريح + مدة التجديد لكل نوع

- permit_log: كل إضافة / تعديل / حذف / مرفق / طباعة / نموذج تصريح لموظف أو عربية (زي سجل الموظف).
  بيتملى من سجل التدقيق القديم: عمليات التصاريح (إضافة، تعديل، حذف، مرفق) — الموظف بالرقم المدني اللي بين
  القوسين، والعربية بـ «السيارة <اللوحة>».
- permit_types.renew_window_days: التصريح بيتجدد في آخر كام يوم قبل انتهاؤه (30 للأنواع الموجودة).

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-01

"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0030"
down_revision: Union[str, None] = "0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIONS = {"permit_add": "add", "permit_edit": "edit", "permit_delete": "delete", "permit_file": "file"}


def upgrade() -> None:
    op.create_table(
        "permit_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("holder_kind", sa.String(length=10), nullable=False),
        sa.Column("holder_id", sa.String(length=64), nullable=False),
        sa.Column("permit_id", sa.String(length=64), nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("label", sa.UnicodeText(), nullable=True),
        sa.Column("date", sa.DateTime(), nullable=True),
        sa.Column("user", sa.Unicode(length=300), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_permit_log")),
    )
    op.create_index(op.f("ix_permit_log_holder_id"), "permit_log", ["holder_id"])
    with op.batch_alter_table("permit_types") as batch:
        batch.add_column(sa.Column("renew_window_days", sa.Integer(), nullable=True))
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE permit_types SET renew_window_days = 30"))
    plates = {str(p).strip(): vid for vid, p in conn.execute(sa.text("SELECT id, plate FROM vehicles")).all()}
    rows = conn.execute(sa.text("SELECT type, label, date, user FROM audit_log WHERE type IN "
                                "('permit_add', 'permit_edit', 'permit_delete', 'permit_file') ORDER BY date")).all()
    for typ, label, when, user in rows:
        label = label or ""
        civil = re.search(r"\((\d{8,14})\)", label)
        plate = re.search(r"السيارة (\S+?)(?=[:\s]|$)", label)
        if civil:
            kind, hid = "employee", civil.group(1)
        elif plate and plates.get(plate.group(1)):
            kind, hid = "vehicle", plates[plate.group(1)]
        else:
            continue
        conn.execute(sa.text("INSERT INTO permit_log (holder_kind, holder_id, action, label, date, user) VALUES (:k, :h, :a, :l, :d, :u)"),
                     {"k": kind, "h": hid, "a": ACTIONS[typ], "l": label, "d": when, "u": user})


def downgrade() -> None:
    with op.batch_alter_table("permit_types") as batch:
        batch.drop_column("renew_window_days")
    op.drop_index(op.f("ix_permit_log_holder_id"), table_name="permit_log")
    op.drop_table("permit_log")
