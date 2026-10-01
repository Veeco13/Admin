"""مسار «إنهاء خدمة — وافد»: الشركة اللي الموظف اتحوّل عليها

- employees.service_end_transfer_to: اسم الشركة الجديدة لما إنهاء الخدمة يكون «تحويل إقامة لشركة أخرى»
  (بيتكتب في أول خطوة من مسار التحويل، وبيتمسح لو الموظف رجع للخدمة).

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("service_end_transfer_to", sa.Unicode(length=300), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("service_end_transfer_to")
