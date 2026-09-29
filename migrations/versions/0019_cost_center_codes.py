"""cost center codes — رمز لكل مركز تكلفة، ورقم الفاتورة برمزه، ورقم لكل تقفيل

- cost_centers.code: رمز إنجليزي فريد (ABE، SUP، …) — بيتقفل نهائيًا أول ما يتستخدم في فاتورة.
- invoices.cc_code: رمز المركز وقت التقفيل ← رقم الفاتورة «INV-SUP-2026-0001» (مسلسل لكل مركز في السنة).
  اللي مالوش مركز تكلفة ← GEN. الرقم الفريد بقى (cc_code, year, no) بدل (year, no).
- invoices.closing_seq / closing_ref: رقم التقفيل «AA-0001/1» (رقم العهدة وقتها / مسلسل التقفيل فيها) — بيتثبّت.
الرموز الأولى متفق عليها لمراكز التكلفة الموجودة (بالاسم الإنجليزي)، والباقي من الاسم.

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-29

"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AGREED = {"abraaj energy": "ABE", "abraaj ultra": "ABU", "abraaj services": "ABS", "superior energy": "SUP", "scomi": "SCO",
          "scomi manpower": "SMP", "xceed": "XCD", "to go": "TGO", "rash": "RSH", "the farm": "FRM", "other": "OTH"}


def _code(name_en, taken):
    """نفس custody.cc_default_code: أول 3 حروف من الاسم الإنجليزي (أو حرف الكلمة الأولى + حرفين من التانية)."""
    words = [w.upper() for w in re.split(r"[^A-Za-z]+", name_en or "") if w]
    cands = [words[0][:3]] if words else []
    if len(words) > 1:
        cands += [words[0][0] + words[1][:2], words[0][:2] + words[1][0]]
    base = next((c for c in cands if len(c) >= 2 and c not in taken), (cands[0] if cands and len(cands[0]) >= 2 else "CC"))[:4]
    code, n = base, 2
    while code in taken:
        code, n = f"{base}{n}", n + 1
    return code


def upgrade() -> None:
    with op.batch_alter_table("cost_centers") as batch:
        batch.add_column(sa.Column("code", sa.String(length=10), nullable=True))
        batch.create_unique_constraint(op.f("uq_cost_centers_code"), ["code"])
    with op.batch_alter_table("invoices") as batch:
        batch.add_column(sa.Column("cc_code", sa.String(length=10), nullable=True))
        batch.add_column(sa.Column("closing_seq", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("closing_ref", sa.String(length=30), nullable=True))
        batch.drop_constraint("uq_invoices_year_no", type_="unique")
        batch.create_unique_constraint(op.f("uq_invoices_cc_code_year_no"), ["cc_code", "year", "no"])
    conn = op.get_bind()
    taken, codes = {"GEN"}, {}
    rows = conn.execute(sa.text("SELECT id, name, name_en FROM cost_centers ORDER BY name")).fetchall()
    for cid, name, name_en in rows:                       # المتفق عليها الأول
        code = AGREED.get((name_en or "").strip().lower())
        if code and code not in taken:
            codes[cid] = code
            taken.add(code)
    for cid, name, name_en in rows:
        if cid not in codes:
            codes[cid] = _code(name_en, taken)
            taken.add(codes[cid])
    by_name = {}
    for cid, name, _ in rows:
        conn.execute(sa.text("UPDATE cost_centers SET code = :c WHERE id = :i"), {"c": codes[cid], "i": cid})
        by_name[name] = codes[cid]
    # الفواتير الموجودة (لو فيه): رمز مركزها ورقم تقفيلها — أرقامها زي ما هي
    refs = {}
    invs = conn.execute(sa.text(
        "SELECT i.id, i.cost_center, i.custody_id, i.closing_date, c.prefix, c.seq, c.no FROM invoices i "
        "JOIN custodies c ON c.id = i.custody_id ORDER BY i.custody_id, i.closing_date")).fetchall()
    for iid, cc, cus, closing, prefix, seq, no in invs:
        key = (cus, str(closing))
        if key not in refs:
            refs[key] = sum(1 for k in refs if k[0] == cus) + 1
        number = f"{prefix}-{seq:04d}" if prefix and seq else f"CUS-{no:04d}"
        conn.execute(sa.text("UPDATE invoices SET cc_code = :c, closing_seq = :s, closing_ref = :r WHERE id = :i"),
                     {"c": by_name.get(cc or "", "GEN"), "s": refs[key], "r": f"{number}/{refs[key]}", "i": iid})


def downgrade() -> None:
    with op.batch_alter_table("invoices") as batch:
        batch.drop_constraint("uq_invoices_cc_code_year_no", type_="unique")
        batch.create_unique_constraint("uq_invoices_year_no", ["year", "no"])
        batch.drop_column("closing_ref")
        batch.drop_column("closing_seq")
        batch.drop_column("cc_code")
    with op.batch_alter_table("cost_centers") as batch:
        batch.drop_constraint("uq_cost_centers_code", type_="unique")
        batch.drop_column("code")
