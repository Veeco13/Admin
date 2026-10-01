"""نماذج تصاريح السيارات: بيانات النماذج اللي مش موجودة في البرنامج

- vehicles: color / color2 (اللون الأول والثاني)، shape / shape_en (الشكل: قاطرة، وانيت…)، chassis_no، model_year،
  model_en (النوع والموديل بالإنجليزي لشهادة الفحص)، permit_code (كود العربية عند الجهة ← آخر رقم شهادة الفحص).
- projects (العقد عند الجهة المالكة): client_start_date / client_end_date / client_ext_date (البدء، الانتهاء، التمديد)،
  client_team / client_team_en / client_team_code (فريق العمل المسؤول ورمزه)، clearance_prefix (الجزء الثابت من رقم شهادة الفحص).
- agencies: contractor_ar / contractor_en (اسم المقاول زي ما هو في عقود الجهة)، signatories (المعتمدين — JSON أسماء)،
  mandoubs (المناديب — JSON أرقام مدنية، الأول هو الافتراضي).

Revision ID: 0037
Revises: 0036
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0037"
down_revision: Union[str, None] = "0036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

VEHICLE = (("color", 120), ("color2", 120), ("shape", 120), ("shape_en", 120), ("chassis_no", 120), ("model_year", 120),
           ("model_en", 300), ("permit_code", 120))
PROJECT_TEXT = (("client_team", 300), ("client_team_en", 300), ("client_team_code", 120), ("clearance_prefix", 120))
PROJECT_DATES = ("client_start_date", "client_end_date", "client_ext_date")


def upgrade() -> None:
    with op.batch_alter_table("vehicles") as batch:
        for name, size in VEHICLE:
            batch.add_column(sa.Column(name, sa.Unicode(length=size), nullable=True))
    with op.batch_alter_table("projects") as batch:
        for name in PROJECT_DATES:
            batch.add_column(sa.Column(name, sa.Date(), nullable=True))
        for name, size in PROJECT_TEXT:
            batch.add_column(sa.Column(name, sa.Unicode(length=size), nullable=True))
    with op.batch_alter_table("agencies") as batch:
        batch.add_column(sa.Column("contractor_ar", sa.Unicode(length=300), nullable=True))
        batch.add_column(sa.Column("contractor_en", sa.Unicode(length=300), nullable=True))
        batch.add_column(sa.Column("signatories", sa.UnicodeText(), nullable=True))
        batch.add_column(sa.Column("mandoubs", sa.UnicodeText(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("agencies") as batch:
        for name in ("mandoubs", "signatories", "contractor_en", "contractor_ar"):
            batch.drop_column(name)
    with op.batch_alter_table("projects") as batch:
        for name, _ in reversed(PROJECT_TEXT):
            batch.drop_column(name)
        for name in reversed(PROJECT_DATES):
            batch.drop_column(name)
    with op.batch_alter_table("vehicles") as batch:
        for name, _ in reversed(VEHICLE):
            batch.drop_column(name)
