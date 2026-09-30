"""candidates.target_project_id — المشروع / العقد المستهدف للمترشّح

عقد عمل المترشّح بياخد إدارة العمل ورقم الملف واسم المشروع من المشروع ده (زي الموظف بالظبط — مثلًا العقود الحكومية
← «إدارة عمل العقود والمشاريع الحكومية» ورقم ملف العقد)، ومن غيره من الشركة المستهدفة. ولما يتحوّل لموظف بيتسجّل عليه.

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("candidates") as batch:
        batch.add_column(sa.Column("target_project_id", sa.String(length=64), nullable=True))
        batch.create_foreign_key(op.f("fk_candidates_target_project_id_projects"), "projects", ["target_project_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("candidates") as batch:
        batch.drop_constraint("fk_candidates_target_project_id_projects", type_="foreignkey")
        batch.drop_column("target_project_id")
