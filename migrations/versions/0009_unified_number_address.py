"""unified number, blood type, address — للنماذج الرسمية (الإقامة ورخصة القيادة)

- companies.unified_number: الرقم الموحد للشركة (رقم المرجع / الشخصية الاعتبارية في نموذج الإقامة).
- employees + candidates: الرقم الموحد، فصيلة الدم، عنوان السكن (المنطقة/القطعة/الشارع/المنزل/الشقة)، هاتف المنزل.
- candidates.gender (زي الموظف) — كله بيتنقل للموظف لما المترشّح يتحوّل.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PERSON = [
    ("unified_number", sa.Unicode(length=120)),
    ("blood_type", sa.String(length=4)),
    ("address_area", sa.Unicode(length=300)),
    ("address_block", sa.Unicode(length=120)),
    ("address_street", sa.Unicode(length=300)),
    ("address_house", sa.Unicode(length=120)),
    ("address_apartment", sa.Unicode(length=120)),
    ("home_phone", sa.Unicode(length=120)),
]


def upgrade() -> None:
    with op.batch_alter_table("companies") as batch:
        batch.add_column(sa.Column("unified_number", sa.Unicode(length=120), nullable=True))
    with op.batch_alter_table("employees") as batch:
        for name, typ in PERSON:
            batch.add_column(sa.Column(name, typ, nullable=True))
    with op.batch_alter_table("candidates") as batch:
        batch.add_column(sa.Column("gender", sa.String(length=10), nullable=True))
        for name, typ in PERSON:
            batch.add_column(sa.Column(name, typ, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("candidates") as batch:
        for name, _ in reversed(PERSON):
            batch.drop_column(name)
        batch.drop_column("gender")
    with op.batch_alter_table("employees") as batch:
        for name, _ in reversed(PERSON):
            batch.drop_column(name)
    with op.batch_alter_table("companies") as batch:
        batch.drop_column("unified_number")
