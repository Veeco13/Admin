"""المستلم = صاحب العهدة: اسمه الأول والثاني من «الاسم الظاهر» للمستخدم (مش كتابة بالإيد)

اسم المستلم كان بيتكتب بالإيد في كل طلب، فنفس الشخص اتسجّل باسمين (مرة عربي ومرة إنجليزي) والأرصدة والمستحقات اتقسمت.
دلوقتي بيتاخد من صاحب العهدة (custody.short_name) — وهنا العهد القديمة بتاخد اسم صاحبها.

Revision ID: 0036
Revises: 0035
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0036"
down_revision: Union[str, None] = "0035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _short(display, username):
    return " ".join((display or "").split()[:2]) or (username or "")


def upgrade() -> None:
    conn = op.get_bind()
    names = {uid: _short(display, username) for uid, display, username in
             conn.execute(sa.text("SELECT id, display_name, username FROM users")).all()}
    for cid, owner, old in conn.execute(sa.text("SELECT id, owner_id, custodian FROM custodies WHERE owner_id IS NOT NULL")).all():
        new = names.get(owner)
        if new and new != old:
            conn.execute(sa.text("UPDATE custodies SET custodian = :n WHERE id = :i"), {"n": new, "i": cid})


def downgrade() -> None:
    pass        # الأسماء المكتوبة بالإيد مابترجعش
