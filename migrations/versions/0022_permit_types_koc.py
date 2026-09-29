"""permit types — أنواع التصاريح الفعلية (KOC، الرتقة والعبدلي، الوفرة) + الجهة المانحة الافتراضية لكل نوع

- permit_types.default_issuer: الجهة المانحة اللي بتتملى لوحدها في التصريح الجديد (بتتعدّل).
- الأنواع التجريبية من 0021 (تصريح دخول، بطاقة أمنية، تصريح مرور) بتتشال لو مفيش عليها تصاريح.
- بيتضاف: تصريح KOC (شركة نفط الكويت)، تصريح الرتقة والعبدلي (الإدارة العامة لأمن الحدود)، تصريح الوفرة
  (العمليات المشتركة) — للموظفين والسيارات،
  والموظف أو العربية ممكن يبقى معاه واحد أو اتنين أو التلاتة (كل تصريح برقمه وتواريخه).

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = ("pt_entry", "pt_security", "pt_traffic")
NEW = [("pt_koc", "تصريح KOC", "KOC Permit", "شركة نفط الكويت", 1),
       ("pt_ratqa", "تصريح الرتقة والعبدلي", "Ratqa & Abdali Permit", "الإدارة العامة لأمن الحدود", 2),
       ("pt_wafra", "تصريح الوفرة", "Wafra Permit", "العمليات المشتركة", 3)]


def upgrade() -> None:
    with op.batch_alter_table("permit_types") as batch:
        batch.add_column(sa.Column("default_issuer", sa.Unicode(length=300), nullable=True))
    conn = op.get_bind()
    for tid in OLD:
        used = conn.execute(sa.text("SELECT COUNT(*) FROM permits WHERE type_id = :t"), {"t": tid}).scalar()
        if not used:
            conn.execute(sa.text("DELETE FROM permit_types WHERE id = :t"), {"t": tid})
    for tid, ar, en, issuer, pos in NEW:
        exists = conn.execute(sa.text("SELECT COUNT(*) FROM permit_types WHERE id = :i OR name_ar = :a"), {"i": tid, "a": ar}).scalar()
        if not exists:
            conn.execute(sa.text("INSERT INTO permit_types (id, name_ar, name_en, applies_to, position, default_issuer) "
                                 "VALUES (:i, :a, :e, NULL, :p, :d)"), {"i": tid, "a": ar, "e": en, "p": pos, "d": issuer})


def downgrade() -> None:
    with op.batch_alter_table("permit_types") as batch:
        batch.drop_column("default_issuer")
