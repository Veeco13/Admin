"""permits — التصاريح للموظفين والسيارات

- permit_types: أنواع التصاريح (مدير النظام بيتحكم فيها) — applies_to: employee / vehicle / فاضي = الاتنين.
- permit_places: أماكن التصاريح (المواقع والمناطق).
- permits: التصريح نفسه — تابع لموظف أو لعربية، النوع والرقم والجهة المانحة والعقد / المشروع وتاريخ الإصدار
  والانتهاء والمرفق (للعرض بس) والملاحظات.
- permit_place_links: التصريح الواحد ممكن يغطي أكتر من مكان.
بيتزرع 3 أنواع للبداية (تصريح دخول، بطاقة أمنية، تصريح مرور) وتتعدّل أو تتشال من «⚙️ الأنواع والأماكن».
صلاحية جديدة «التصاريح» (permits.view / edit / delete): الأدوار اللي كان معاها عرض / تعديل / حذف الموظفين أو
السيارات بتاخد نفسها في التصاريح (عشان محدش يفقد حاجة كان بيعملها)، ومدير النظام يغيّرها من الأدوار.

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-29

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TYPES = [("pt_entry", "تصريح دخول", "Entry permit", None, 1),
         ("pt_security", "بطاقة أمنية", "Security card", "employee", 2),
         ("pt_traffic", "تصريح مرور", "Traffic permit", "vehicle", 3)]


def upgrade() -> None:
    op.create_table(
        "permit_types",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name_ar", sa.Unicode(length=300), nullable=False),
        sa.Column("name_en", sa.Unicode(length=300), nullable=True),
        sa.Column("applies_to", sa.String(length=10), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_permit_types")),
    )
    op.create_table(
        "permit_places",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name_ar", sa.Unicode(length=300), nullable=False),
        sa.Column("name_en", sa.Unicode(length=300), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_permit_places")),
    )
    op.create_table(
        "permits",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("holder_kind", sa.String(length=10), nullable=False),
        sa.Column("employee_id", sa.String(length=64), nullable=True),
        sa.Column("vehicle_id", sa.String(length=64), nullable=True),
        sa.Column("type_id", sa.String(length=64), nullable=False),
        sa.Column("permit_no", sa.Unicode(length=120), nullable=True),
        sa.Column("issuer", sa.Unicode(length=300), nullable=True),
        sa.Column("project_id", sa.String(length=64), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.UnicodeText(), nullable=True),
        sa.Column("file_path", sa.Unicode(length=500), nullable=True),
        sa.Column("file_name", sa.Unicode(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.Unicode(length=300), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("updated_by", sa.Unicode(length=300), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name=op.f("fk_permits_employee_id_employees")),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], name=op.f("fk_permits_vehicle_id_vehicles")),
        sa.ForeignKeyConstraint(["type_id"], ["permit_types.id"], name=op.f("fk_permits_type_id_permit_types")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], name=op.f("fk_permits_project_id_projects")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_permits")),
    )
    op.create_index(op.f("ix_permits_employee_id"), "permits", ["employee_id"])
    op.create_index(op.f("ix_permits_vehicle_id"), "permits", ["vehicle_id"])
    op.create_table(
        "permit_place_links",
        sa.Column("permit_id", sa.String(length=64), nullable=False),
        sa.Column("place_id", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["permit_id"], ["permits.id"], name=op.f("fk_permit_place_links_permit_id_permits")),
        sa.ForeignKeyConstraint(["place_id"], ["permit_places.id"], name=op.f("fk_permit_place_links_place_id_permit_places")),
        sa.PrimaryKeyConstraint("permit_id", "place_id", name=op.f("pk_permit_place_links")),
    )
    conn = op.get_bind()
    for rid, raw in conn.execute(sa.text("SELECT id, permissions FROM roles")).fetchall():
        try:
            keys = json.loads(raw or "[]")
        except ValueError:
            continue
        add = [f"permits.{a}" for a in ("view", "edit", "delete")
               if (f"employees.{a}" in keys or f"vehicles.{a}" in keys) and f"permits.{a}" not in keys]
        if add:
            conn.execute(sa.text("UPDATE roles SET permissions = :p WHERE id = :i"), {"p": json.dumps(keys + add), "i": rid})
    for i, ar, en, applies, pos in TYPES:
        conn.execute(sa.text("INSERT INTO permit_types (id, name_ar, name_en, applies_to, position) VALUES (:i, :a, :e, :t, :p)"),
                     {"i": i, "a": ar, "e": en, "t": applies, "p": pos})


def downgrade() -> None:
    op.drop_table("permit_place_links")
    op.drop_index(op.f("ix_permits_vehicle_id"), table_name="permits")
    op.drop_index(op.f("ix_permits_employee_id"), table_name="permits")
    op.drop_table("permits")
    op.drop_table("permit_places")
    op.drop_table("permit_types")
