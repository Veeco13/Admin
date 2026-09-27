"""employee residency fields — الجنس ومكان الميلاد وتاريخ إصدار الجواز

البيانات دي محتاجها «نموذج الإقامة الجديد 2018» (residency_form.py). كلها اختيارية.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("gender", sa.String(length=10), nullable=True))
        batch.add_column(sa.Column("place_of_birth", sa.Unicode(length=300), nullable=True))
        batch.add_column(sa.Column("passport_issue_date", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("passport_issue_date")
        batch.drop_column("place_of_birth")
        batch.drop_column("gender")
