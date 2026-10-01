"""أجزاء التصاريح: المقاول من الباطن في التصريح، ونطاق الأجزاء للمستخدم

قسم التصاريح بيتقسم «أجزاء» — كل وكالة أو شركة ليها تصاريحها (موظفين وسيارات). الجزء بيتحدد من التصريح نفسه:
- permits.subcontractor_id: الشركة اللي داخلة مقاول من الباطن على عقد المقاول الرئيسي ← التصريح في جزءها.
  فاضي ← التصريح في جزء صاحب العقد (وكالته، أو شركته لو العقد من غير وكالة).
- users.permit_parts: الأجزاء اللي المستخدم يشوفها (JSON مفاتيح «ag:<وكالة>» / «co:<شركة>») — فاضي = الكل.

ترتيب الأجزاء والشركات اللي بتدخل من الباطن إعداد في meta (permit_parts) — مفيش بيانات عميل هنا.

Revision ID: 0038
Revises: 0037
Create Date: 2026-10-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0038"
down_revision: Union[str, None] = "0037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("permits") as batch:
        batch.add_column(sa.Column("subcontractor_id", sa.String(length=64), nullable=True))
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("permit_parts", sa.UnicodeText(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("permit_parts")
    with op.batch_alter_table("permits") as batch:
        batch.drop_column("subcontractor_id")
