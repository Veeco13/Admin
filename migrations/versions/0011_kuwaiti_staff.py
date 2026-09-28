"""kuwaiti staff — بيانات العمالة الوطنية ونماذجها

- الموظف: الحالة الاجتماعية، المؤهل الدراسي، التخصص، البريد الإلكتروني، بيانات الجنسية (تاريخ التجنس، المادة،
  رقم الجنسية)، الدراسة الحالية (الجهة، داخل/خارج الكويت، بداية القيد)، والأبناء (قائمة JSON).
- الشركة: رقم التسجيل في المؤسسة العامة للتأمينات الاجتماعية (استمارة 103).
- المفوّض بالتوقيع: المسمى الوظيفي (إقرار استمارة 103).

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EMPLOYEE_COLUMNS = (
    ("marital_status", sa.String(20)),
    ("qualification", sa.Unicode(120)),
    ("specialization", sa.Unicode(300)),
    ("email", sa.Unicode(120)),
    ("naturalization_date", sa.Date()),
    ("citizenship_article", sa.Unicode(120)),
    ("nationality_no", sa.Unicode(120)),
    ("study_institution", sa.Unicode(300)),
    ("study_abroad", sa.Boolean()),
    ("study_start_date", sa.Date()),
    ("children", sa.UnicodeText()),
)


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        for name, type_ in EMPLOYEE_COLUMNS:
            batch.add_column(sa.Column(name, type_, nullable=True))
    with op.batch_alter_table("companies") as batch:
        batch.add_column(sa.Column("pifss_no", sa.Unicode(120), nullable=True))
    with op.batch_alter_table("signatories") as batch:
        batch.add_column(sa.Column("title", sa.Unicode(300), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("signatories") as batch:
        batch.drop_column("title")
    with op.batch_alter_table("companies") as batch:
        batch.drop_column("pifss_no")
    with op.batch_alter_table("employees") as batch:
        for name, _ in reversed(EMPLOYEE_COLUMNS):
            batch.drop_column(name)
