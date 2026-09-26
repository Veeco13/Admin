"""signatures — صور التوقيعات (مفوّضين وموظفين) + صلاحية العقود بالتوقيعات

- جدول signatures: توقيع واحد لكل رقم مدني
- صلاحية جديدة contract.sign (طباعة العقود بالتوقيعات المرفوعة) ← بتتضاف لدوري «محرر» و«موارد بشرية»

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-27

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "contract.sign"
ROLES = ("editor", "hr")


def _edit_roles(fn):
    conn = op.get_bind()
    for rid, perms in conn.execute(sa.text("SELECT id, permissions FROM roles")).all():
        if rid not in ROLES:
            continue
        keys = fn(json.loads(perms or "[]"))
        conn.execute(sa.text("UPDATE roles SET permissions = :p WHERE id = :i"), {"p": json.dumps(keys), "i": rid})


def upgrade() -> None:
    op.create_table(
        "signatures",
        sa.Column("civil_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Unicode(length=300), nullable=True),
        sa.Column("path", sa.Unicode(length=500), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(), nullable=True),
        sa.Column("uploaded_by", sa.Unicode(length=300), nullable=True),
        sa.PrimaryKeyConstraint("civil_id", name=op.f("pk_signatures")),
    )
    _edit_roles(lambda keys: keys if KEY in keys else keys + [KEY])


def downgrade() -> None:
    _edit_roles(lambda keys: [k for k in keys if k != KEY])
    op.drop_table("signatures")
