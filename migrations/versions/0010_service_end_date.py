"""service end date — تاريخ انتهاء الخدمة (آخر يوم عمل)

«إقرار مخالصة عمالية نهائية» فيه الفترة من تاريخ التعيين لحد تاريخ انتهاء الخدمة.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("service_end_date", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("service_end_date")
