"""هوية المنتج LUNX: اسم الجهة المرخّص لها بقى إعداد (مش مكتوب في البرنامج)

- meta.org_name / meta.org_name_en: «اسم الجهة» اللي بيظهر جنب LUNX في الشريط العلوي وفي صفحة الدخول.
  النسخة اللي عليها شركات أبراج (أول عميل) بتاخد اسمها لوحدها علشان مايتغيّرش عليهم حاجة:
  «مجموعة شركات أبراج وشركائها» / "Abraaj Group of Companies & Partners". أي نسخة تانية بتبدأ فاضية ومدير النظام
  بيكتب الاسم من «عن البرنامج».

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0032"
down_revision: Union[str, None] = "0031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ABRAAJ = {"org_name": "مجموعة شركات أبراج وشركائها", "org_name_en": "Abraaj Group of Companies & Partners"}


def upgrade() -> None:
    conn = op.get_bind()
    if conn.execute(sa.text("SELECT COUNT(*) FROM meta WHERE key = 'org_name'")).scalar():
        return
    abraaj = conn.execute(sa.text("SELECT COUNT(*) FROM companies WHERE lower(name_en) LIKE 'abraaj%' OR name_ar LIKE '%أبراج%'")).scalar()
    if not abraaj:
        return
    for key, value in ABRAAJ.items():
        conn.execute(sa.text("INSERT INTO meta (key, value) VALUES (:k, :v)"), {"k": key, "v": value})


def downgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM meta WHERE key IN ('org_name', 'org_name_en')"))
