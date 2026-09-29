"""custody owner — العهد لكل مستخدم ورقمها برمزه

- users.custody_code: رمز المستخدم في أرقام العهد (حروف إنجليزي، مثلًا AA) — مدير النظام بيعدّله من شاشة المستخدمين.
- custodies.owner_id: المستخدم صاحب العهدة (بيشوفها هو بس، وصاحب «عرض عهد كل المستخدمين»).
- custodies.prefix / seq: رقم العهدة «AA-0001» — الرمز وقت الطلب ومسلسل لكل رمز (مابيتغيّرش لو الرمز اتغيّر بعدين).
- custody_lines.dup_ok: الشخص اتطلب تاني خلال 90 يوم من تقفيل نفس النوع وتم التأكيد ← فحص التقفيل بيعدّيه.
العهد القديمة: صاحبها من created_by (الاسم الظاهر أو اسم الدخول)، وإلا أول مدير نظام.

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-29

"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _code(username, uid, taken):
    """نفس custody.default_code: الحروف الأولى لأجزاء اسم الدخول (a.ahmed ← AA) أو أول 3 حروف (admin ← ADM)."""
    parts = [p for p in re.split(r"[^A-Za-z]+", username or "") if p]
    base = ("".join(p[0] for p in parts) if len(parts) > 1 else (parts[0][:3] if parts else "")).upper()
    if len(base) < 2:
        base = f"U{uid}"
    code, n = base, 2
    while code in taken:
        code, n = f"{base}{n}", n + 1
    return code


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("custody_code", sa.String(length=10), nullable=True))
    with op.batch_alter_table("custodies") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("prefix", sa.String(length=10), nullable=True))
        batch.add_column(sa.Column("seq", sa.Integer(), nullable=True))
    with op.batch_alter_table("custody_lines") as batch:
        batch.add_column(sa.Column("dup_ok", sa.Boolean(), nullable=False, server_default=sa.false()))
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT u.id, u.username, u.display_name, COALESCE(r.is_admin, 0) FROM users u "
                                 "LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.id")).fetchall()
    codes, taken = {}, set()
    for uid, username, _, _ in users:
        codes[uid] = _code(username, uid, taken)
        taken.add(codes[uid])
        conn.execute(sa.text("UPDATE users SET custody_code = :c WHERE id = :i"), {"c": codes[uid], "i": uid})
    by_name = {}
    for uid, username, display, _ in users:
        by_name.setdefault(username, uid)
        if display:
            by_name.setdefault(display, uid)
    admin = next((uid for uid, _, _, is_admin in users if is_admin), users[0][0] if users else None)
    seqs = {}
    for cid, created_by in conn.execute(sa.text("SELECT id, created_by FROM custodies ORDER BY no")).fetchall():
        owner = by_name.get(created_by or "", admin)
        prefix = codes.get(owner, "CUS")
        seqs[prefix] = seqs.get(prefix, 0) + 1
        conn.execute(sa.text("UPDATE custodies SET owner_id = :o, prefix = :p, seq = :n WHERE id = :i"),
                     {"o": owner, "p": prefix, "n": seqs[prefix], "i": cid})


def downgrade() -> None:
    with op.batch_alter_table("custody_lines") as batch:
        batch.drop_column("dup_ok")
    with op.batch_alter_table("custodies") as batch:
        batch.drop_column("seq")
        batch.drop_column("prefix")
        batch.drop_column("owner_id")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("custody_code")
