"""cost center company — ربط مركز التكلفة بالشركة الفعلية

الموظف ممكن يكون على ورق شركة وشغال في شركة تانية (بيتحدد بمركز التكلفة).
cost_centers.company_id = الشركة الفعلية ← المستخدم المحصور في شركة بيشوف موظفين مراكز تكلفتها كمان.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("cost_centers") as batch:
        batch.add_column(sa.Column("company_id", sa.String(length=64), nullable=True))
        batch.create_index(batch.f("ix_cost_centers_company_id"), ["company_id"])
        batch.create_foreign_key("fk_cost_centers_company_id_companies", "companies", ["company_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("cost_centers") as batch:
        batch.drop_constraint("fk_cost_centers_company_id_companies", type_="foreignkey")
        batch.drop_index(batch.f("ix_cost_centers_company_id"))
        batch.drop_column("company_id")
