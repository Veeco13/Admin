"""kuwaiti candidates — بيانات العمالة الوطنية للمترشّحين

تعيين العمالة الوطنية بيتم من «تسجيل موظف جديد» (الاستقدام): المترشّح الكويتي بيطبع استمارة 103 واستمارة
العلاوة الاجتماعية مع عقد العمل، فمحتاج نفس بيانات الموظف (0011)، وبتتنقل معاه لما يتحوّل لموظف.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CANDIDATE_COLUMNS = (
    ("email", sa.Unicode(120)),
    ("marital_status", sa.String(20)),
    ("qualification", sa.Unicode(120)),
    ("specialization", sa.Unicode(300)),
    ("naturalization_date", sa.Date()),
    ("citizenship_article", sa.Unicode(120)),
    ("nationality_no", sa.Unicode(120)),
    ("study_institution", sa.Unicode(300)),
    ("study_abroad", sa.Boolean()),
    ("study_start_date", sa.Date()),
    ("children", sa.UnicodeText()),
)


def upgrade() -> None:
    with op.batch_alter_table("candidates") as batch:
        for name, type_ in CANDIDATE_COLUMNS:
            batch.add_column(sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("candidates") as batch:
        for name, _ in reversed(CANDIDATE_COLUMNS):
            batch.drop_column(name)
