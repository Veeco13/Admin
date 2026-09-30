"""تصريح بيعتمد على تصريح تاني + العقد من الباطن

- permit_types: requires_type_id (مايطلعش غير لو صاحبه معاه تصريح ساري من النوع ده)، same_expiry (بينتهي مع
  تاريخه وعلى نفس عقده). «تصريح الرتقة والعبدلي» ← محتاج «تصريح KOC» وبينتهي معاه.
- permits: parent_id (التصريح الأساسي — الرتقة ← الـ KOC بتاعه). تصاريح الرتقة الموجودة بتتربط بـ KOC نفس
  الشخص: اللي بينتهي في نفس اليوم، وإلا الأبعد انتهاءً.
- العقد من الباطن (projects.kind = 'sub') مالوش أعمدة جديدة.
- المرجعين من غير FK (لنفس الجدول) علشان ترتيب الصفوف في الاستعادة والنقل مايفرقش.

Revision ID: 0028
Revises: 0027
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def link_dependents(conn):
    """تصاريح الأنواع المعتمدة اللي مالهاش أساسي ← أساسي من نفس الشخص (نفس تاريخ الانتهاء، وإلا الأبعد)."""
    types = conn.execute(sa.text("SELECT id, requires_type_id FROM permit_types WHERE requires_type_id IS NOT NULL")).all()
    for tid, req in types:
        kids = conn.execute(sa.text("SELECT id, holder_kind, employee_id, vehicle_id, expiry_date FROM permits "
                                    "WHERE type_id = :t AND parent_id IS NULL"), {"t": tid}).all()
        for pid, kind, emp, veh, exp in kids:
            col = "employee_id" if kind == "employee" else "vehicle_id"
            rows = conn.execute(sa.text(f"SELECT id, expiry_date FROM permits WHERE type_id = :r AND {col} = :h "
                                        "ORDER BY expiry_date DESC"), {"r": req, "h": emp if kind == "employee" else veh}).all()
            if not rows:
                continue
            same = [r[0] for r in rows if str(r[1]) == str(exp)]
            conn.execute(sa.text("UPDATE permits SET parent_id = :p WHERE id = :i"), {"p": same[0] if same else rows[0][0], "i": pid})


def upgrade() -> None:
    with op.batch_alter_table("permit_types") as batch:
        batch.add_column(sa.Column("requires_type_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("same_expiry", sa.Boolean(), nullable=True))
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("parent_id", sa.String(length=64), nullable=True))
    op.create_index(op.f("ix_permits_parent_id"), "permits", ["parent_id"])
    conn = op.get_bind()
    both = conn.execute(sa.text("SELECT COUNT(*) FROM permit_types WHERE id IN ('pt_koc', 'pt_ratqa')")).scalar()
    if both == 2:
        conn.execute(sa.text("UPDATE permit_types SET requires_type_id = 'pt_koc', same_expiry = :t "
                             "WHERE id = 'pt_ratqa' AND requires_type_id IS NULL"), {"t": True})
    link_dependents(conn)


def downgrade() -> None:
    op.drop_index(op.f("ix_permits_parent_id"), table_name="permits")
    with op.batch_alter_table("permits") as batch:
        batch.drop_column("parent_id")
    with op.batch_alter_table("permit_types") as batch:
        batch.drop_column("same_expiry")
        batch.drop_column("requires_type_id")
