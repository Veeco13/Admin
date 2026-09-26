"""user cost centers — مراكز تكلفة في نطاق المستخدم

مركز تكلفة من غير شركة مسجّلة (زي «سويبريور انرجي») مكانش ينفع يدخل في نطاق حد.
user_cost_centers: المستخدم بيشوف موظفين المراكز دي زيادة على شركاته.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_cost_centers",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("cost_center_id", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_user_cost_centers_user_id_users"),
        sa.ForeignKeyConstraint(["cost_center_id"], ["cost_centers.id"], name="fk_user_cost_centers_cost_center_id_cost_centers"),
        sa.PrimaryKeyConstraint("user_id", "cost_center_id", name=op.f("pk_user_cost_centers")),
    )


def downgrade() -> None:
    op.drop_table("user_cost_centers")
