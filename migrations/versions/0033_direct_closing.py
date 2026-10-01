"""تقفيل عهدة مباشر: إجراء اتصرف عليه من فلوس عهدة لشخص مش في أي طلب

- custodies.direct: العهدة دي «تقفيل مباشر» (اتسجّلت واتقفلت في خطوة واحدة من غير طلب صرف).
- custodies.carry_to_id: طلب العهدة اللي مبلغ التقفيل المباشر اتضاف عليه (أقرب طلب لنفس المستلم) — فاضي = لسه مااتضافش.

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0033"
down_revision: Union[str, None] = "0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("custodies") as batch:
        batch.add_column(sa.Column("direct", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("carry_to_id", sa.String(length=64), nullable=True))
        batch.create_index("ix_custodies_carry_to_id", ["carry_to_id"])


def downgrade() -> None:
    with op.batch_alter_table("custodies") as batch:
        batch.drop_index("ix_custodies_carry_to_id")
        batch.drop_column("carry_to_id")
        batch.drop_column("direct")
