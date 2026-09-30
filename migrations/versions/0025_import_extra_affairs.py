"""الاستيراد التكميلي + ملف الشؤون ومع مين للعربية + تاريخ دخول الكويت وجهة التخرج للموظف

- employees: kuwait_entry_date (تاريخ دخول الكويت)، university (الجامعة / جهة التخرج — غير «جهة الدراسة الحالية»
  بتاعة العمالة الوطنية).
- vehicles: affairs_project_id (ملف الشؤون المسجّلة عليه — علشان العمالة، غير العقد اللي بيأثر على التصاريح)،
  user_name (مع مين / المستخدم — اسم حر لو اللي معاه العربية مش موظف متسجّل).
- import_batches / import_changes: كل دفعة استيراد تكميلي وكل قيمة اتغيّرت فيها (القديمة والجديدة) ← التراجع.

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("kuwait_entry_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("university", sa.Unicode(length=300), nullable=True))
    with op.batch_alter_table("vehicles") as batch:
        batch.add_column(sa.Column("affairs_project_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("user_name", sa.Unicode(length=300), nullable=True))
        batch.create_foreign_key(op.f("fk_vehicles_affairs_project_id_projects"), "projects", ["affairs_project_id"], ["id"])
    op.create_table(
        "import_batches",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("target", sa.String(length=20), nullable=False),
        sa.Column("file_name", sa.Unicode(length=300), nullable=True),
        sa.Column("sheet", sa.Unicode(length=120), nullable=True),
        sa.Column("summary", sa.UnicodeText(), nullable=True),
        sa.Column("created_by", sa.Unicode(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("undone_by", sa.Unicode(length=300), nullable=True),
        sa.Column("undone_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_import_batches")),
    )
    op.create_table(
        "import_changes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.String(length=64), nullable=False),
        sa.Column("entity", sa.String(length=20), nullable=False),
        sa.Column("record_id", sa.String(length=64), nullable=False),
        sa.Column("field", sa.String(length=60), nullable=False),
        sa.Column("old_value", sa.UnicodeText(), nullable=True),
        sa.Column("new_value", sa.UnicodeText(), nullable=True),
        sa.ForeignKeyConstraint(["batch_id"], ["import_batches.id"], name=op.f("fk_import_changes_batch_id_import_batches")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_import_changes")),
    )
    op.create_index(op.f("ix_import_changes_batch_id"), "import_changes", ["batch_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_import_changes_batch_id"), table_name="import_changes")
    op.drop_table("import_changes")
    op.drop_table("import_batches")
    with op.batch_alter_table("vehicles") as batch:
        batch.drop_constraint("fk_vehicles_affairs_project_id_projects", type_="foreignkey")
        batch.drop_column("user_name")
        batch.drop_column("affairs_project_id")
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("university")
        batch.drop_column("kuwait_entry_date")
