"""ورق الشركة الرسمي (letterhead): صورة A4 لكل شركة — بتظهر خلفية في معاينة الشهادات بس (مابتتطبعش)

- companies.letterhead_path: صورة الورق (uploads/letterheads).
- companies.letterhead_top / letterhead_bottom: آخر الترويسة من فوق وبداية التذييل من تحت بالملّي — بيتقاسوا من الصورة
  وقت الرفع، والشهادة بتظبط هوامشها عليهم (الكتابة تحت الترويسة، والرقم المرجعي فوق التذييل المطبوع).

Revision ID: 0034
Revises: 0033
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0034"
down_revision: Union[str, None] = "0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("companies") as batch:
        batch.add_column(sa.Column("letterhead_path", sa.Unicode(length=500), nullable=True))
        batch.add_column(sa.Column("letterhead_top", sa.Float(), nullable=True))
        batch.add_column(sa.Column("letterhead_bottom", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("companies") as batch:
        batch.drop_column("letterhead_bottom")
        batch.drop_column("letterhead_top")
        batch.drop_column("letterhead_path")
