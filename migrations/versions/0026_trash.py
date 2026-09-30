"""trash — 🗑️ سلة المحذوفات

الموظف / المترشّح / العربية / التصريح المحذوف بيتحفظ هنا بنسخة كاملة منه ومن المرتبط بيه (JSON)، وملفاته بتتنقل
لـ trash/<id>/ ← «♻️ استرجاع» بيرجّعه، وبعد 90 يوم بيتحذف نهائي.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "trash",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("record_id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.Unicode(length=300), nullable=True),
        sa.Column("company_ids", sa.UnicodeText(), nullable=True),
        sa.Column("data", sa.UnicodeText(), nullable=True),
        sa.Column("deleted_by", sa.Unicode(length=300), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trash")),
    )
    op.create_index(op.f("ix_trash_deleted_at"), "trash", ["deleted_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_trash_deleted_at"), table_name="trash")
    op.drop_table("trash")
