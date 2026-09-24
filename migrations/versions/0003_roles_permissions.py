"""roles & permissions — أدوار بصلاحيات مرنة + نطاق شركات لكل مستخدم

- جدول roles (الصلاحيات JSON) + user_companies
- users: role (نص) ← role_id، ومعاه all_companies / active / job_title / email / phone / last_login / created_at
- المستخدمين الحاليين بيتحوّلوا بنفس صلاحياتهم: admin ← مدير النظام، editor ← محرر، viewer ← مشاهد

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-25

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# نسخة ثابتة من الكتالوج وقت الترحيل (عشان الترحيل مايتغيرش لو perms.py اتعدّل بعدين)
_MODS = {"employees": "ved", "companies": "ved", "vehicles": "ved", "costcenters": "ved",
         "recruitment": "ved", "contract": "ve", "companylog": "v"}
_ACT = {"v": "view", "e": "edit", "d": "delete"}
_SENS = ["sensitive.salary", "sensitive.bank", "sensitive.documents"]
_SYS = ["system.import", "system.backup"]


def _p(spec):
    """{'employees': 've'} ← ['employees.view', 'employees.edit']"""
    return [f"{m}.{_ACT[a]}" for m, acts in spec.items() for a in acts]


ALL_MODULES = _p(_MODS)
VIEW_ALL = _p({m: "v" for m in _MODS})

# (id, الاسم, الوصف, الصلاحيات, is_admin, is_system)
ROLES = [
    ("admin", "مدير النظام", "كل الصلاحيات وكل الشركات، وإدارة المستخدمين والاستعادة", [], True, True),
    ("editor", "محرر", "إضافة وتعديل وحذف في كل الأقسام، ويشوف كل البيانات الحساسة",
     ALL_MODULES + _SENS + _SYS, False, True),
    ("viewer", "مشاهد", "قراءة فقط، من غير البيانات الحساسة", VIEW_ALL, False, True),
    ("hr", "موارد بشرية", "الموظفين والاستقدام والعقود بالكامل مع المرتبات والبنوك",
     _p({"employees": "ved", "companies": "v", "costcenters": "v", "recruitment": "ved", "contract": "ve",
         "companylog": "v"}) + _SENS + ["system.import"], False, False),
    ("pro", "مندوب حكومي", "متابعة الإقامات والمعاملات الحكومية والسيارات",
     _p({"employees": "ve", "companies": "v", "vehicles": "ve"}) + ["sensitive.documents"], False, False),
    ("recruiter", "استقدام", "ملف المترشّحين وتحويلهم لموظفين",
     _p({"recruitment": "ve", "employees": "v", "companies": "v"}) + ["sensitive.documents"], False, False),
    ("accountant", "محاسب", "المرتبات والبنوك ومراكز التكلفة (عرض الموظفين فقط)",
     _p({"employees": "v", "companies": "v", "costcenters": "ve", "companylog": "v"})
     + ["sensitive.salary", "sensitive.bank"], False, False),
]


def upgrade() -> None:
    roles = op.create_table(
        "roles",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Unicode(length=300), nullable=False),
        sa.Column("description", sa.UnicodeText(), nullable=True),
        sa.Column("permissions", sa.UnicodeText(), nullable=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_roles")),
        sa.UniqueConstraint("name", name=op.f("uq_roles_name")),
    )
    op.bulk_insert(roles, [{"id": i, "name": n, "description": d, "permissions": json.dumps(p),
                            "is_admin": a, "is_system": sy} for i, n, d, p, a, sy in ROLES])

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("role_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("all_companies", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.add_column(sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.add_column(sa.Column("job_title", sa.Unicode(length=300), nullable=True))
        batch.add_column(sa.Column("email", sa.Unicode(length=120), nullable=True))
        batch.add_column(sa.Column("phone", sa.Unicode(length=120), nullable=True))
        batch.add_column(sa.Column("last_login", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("created_at", sa.DateTime(), nullable=True))

    # الأدوار القديمة ← الجديدة (أي قيمة غريبة ← مشاهد)
    op.execute(sa.text("UPDATE users SET role_id = CASE role WHEN 'admin' THEN 'admin' "
                       "WHEN 'editor' THEN 'editor' ELSE 'viewer' END"))

    with op.batch_alter_table("users") as batch:
        batch.drop_column("role")
        batch.create_index(batch.f("ix_users_role_id"), ["role_id"])
        batch.create_foreign_key("fk_users_role_id_roles", "roles", ["role_id"], ["id"])

    op.create_table(
        "user_companies",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_user_companies_user_id_users"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name="fk_user_companies_company_id_companies"),
        sa.PrimaryKeyConstraint("user_id", "company_id", name=op.f("pk_user_companies")),
    )


def downgrade() -> None:
    op.drop_table("user_companies")
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("role", sa.String(length=20), nullable=False, server_default="viewer"))
    op.execute(sa.text("UPDATE users SET role = CASE role_id WHEN 'admin' THEN 'admin' "
                       "WHEN 'viewer' THEN 'viewer' ELSE 'editor' END"))
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("fk_users_role_id_roles", type_="foreignkey")
        batch.drop_index(batch.f("ix_users_role_id"))
        for c in ("created_at", "last_login", "phone", "email", "job_title", "active", "all_companies", "role_id"):
            batch.drop_column(c)
    op.drop_table("roles")
