"""custody — العهد والمصروفات

- fee_items: جدول رسوم المعاملات لكل نوع طلب (بيتعدّل من الشاشة). البند مربوط بمرحلة (مراحل المعاملة الحكومية
  للموظف أو مراحل «تسجيل موظف جديد» للمترشّح) فبيتعلّم «تم» لوحده لما المرحلة تعدّيه.
- custodies: العهدة (نوعها، المستلم، المطلوب، المصروف فعلًا وتاريخه، الحالة).
- custody_lines: بند لكل شخص × إجراء — بنسخة من الاسم ومركز التكلفة والشركة والبند وقت الطلب
  (فتعديل جدول الرسوم أو نقل الموظف بعدين مايغيّرش عهدة قديمة).
- صلاحيات custody.* ← بتتضاف لدور «محرر».

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-28

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEYS = ["custody.view", "custody.edit", "custody.delete", "custody.fees"]
ROLES = ("editor",)
MOI, PAM, MOH, PACI, MOFA = ("وزارة الداخلية", "الهيئة العامة للقوى العاملة", "وزارة الصحة",
                             "الهيئة العامة للمعلومات المدنية", "وزارة الخارجية")
WP_OPTIONS = "60,260,360,460"
# (نوع الطلب، الترتيب، البند، الجهة، المبلغ، الاختيارات، المرحلة)
DEFAULT_FEES = [
    ("renewal", 1, "تجديد إذن العمل", PAM, 10, None, "awaiting_work_permit"),
    ("renewal", 2, "تجديد الضمان الصحي", MOH, 100, None, "health_insurance"),
    ("renewal", 3, "تجديد الإقامة", MOI, 20, None, "residency"),
    ("renewal", 4, "تجديد البطاقة المدنية", PACI, 5, None, "civil_id"),
    ("transfer_in", 1, "إصدار إذن العمل", PAM, 60, WP_OPTIONS, "awaiting_work_permit"),
    ("transfer_in", 2, "إصدار الضمان الصحي", MOH, 100, None, "health_insurance"),
    ("transfer_in", 3, "تحويل الإقامة", MOI, 20, None, "residency"),
    ("transfer_in", 4, "تجديد البطاقة المدنية", PACI, 5, None, "civil_id"),
    ("transfer_out", 1, "إصدار إذن العمل", PAM, 60, WP_OPTIONS, "transfer_work_license"),
    ("transfer_out", 2, "إصدار الضمان الصحي", MOH, 100, None, "health_insurance_internal"),
    ("transfer_out", 3, "تحويل الإقامة", MOI, 20, None, "residency_issue_internal"),
    ("transfer_out", 4, "تجديد البطاقة المدنية", PACI, 5, None, "civil_id_renew"),
    ("visa", 1, "إصدار تأشيرة العمل", MOI, 20, None, "work_visa"),
    ("first_residency", 1, "الكشف الطبي", MOH, 10, None, "medical_exam"),
    ("first_residency", 2, "تصديق الأوراق", MOFA, None, None, "foreign_ministry_auth"),
    ("first_residency", 3, "إصدار إذن العمل أول مرة", PAM, 60, None, "work_license"),
    ("first_residency", 4, "إصدار الضمان الصحي", MOH, 100, None, "health_insurance"),
    ("first_residency", 5, "إصدار الإقامة", MOI, 20, None, "residency_issue"),
    ("first_residency", 6, "إصدار البطاقة المدنية", PACI, 5, None, "civil_id_issue"),
]


def _edit_roles(fn):
    conn = op.get_bind()
    for rid, perms in conn.execute(sa.text("SELECT id, permissions FROM roles")).all():
        if rid in ROLES:
            conn.execute(sa.text("UPDATE roles SET permissions = :p WHERE id = :i"),
                         {"p": json.dumps(fn(json.loads(perms or "[]"))), "i": rid})


def upgrade() -> None:
    fee_items = op.create_table(
        "fee_items",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tx_type", sa.String(length=30), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.Unicode(length=300), nullable=False),
        sa.Column("authority", sa.Unicode(length=300), nullable=True),
        sa.Column("amount", sa.Float(), nullable=True),               # فاضي = مبلغ مفتوح لكل شخص (التصديقات)
        sa.Column("options", sa.Unicode(length=120), nullable=True),  # «60,260,360,460» = اختيارات المبلغ
        sa.Column("stage", sa.String(length=60), nullable=True),      # المرحلة اللي بتعلّم البند «تم»
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_fee_items")),
    )
    op.create_index(op.f("ix_fee_items_tx_type"), "fee_items", ["tx_type"])
    op.create_table(
        "custodies",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("no", sa.Integer(), nullable=False),
        sa.Column("tx_type", sa.String(length=30), nullable=False),
        sa.Column("custodian", sa.Unicode(length=300), nullable=False),
        sa.Column("company_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),     # requested | disbursed | closed | cancelled
        sa.Column("request_date", sa.Date(), nullable=True),
        sa.Column("requested_amount", sa.Float(), nullable=True),
        sa.Column("disbursed_amount", sa.Float(), nullable=True),
        sa.Column("disbursed_date", sa.Date(), nullable=True),
        sa.Column("closed_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.UnicodeText(), nullable=True),
        sa.Column("created_by", sa.Unicode(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name=op.f("fk_custodies_company_id_companies")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_custodies")),
        sa.UniqueConstraint("no", name=op.f("uq_custodies_no")),
    )
    op.create_table(
        "custody_lines",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("custody_id", sa.String(length=64), nullable=False),
        sa.Column("person_kind", sa.String(length=20), nullable=False),   # employee | candidate
        sa.Column("person_id", sa.String(length=64), nullable=False),
        sa.Column("person_name", sa.Unicode(length=300), nullable=True),
        sa.Column("civil_id", sa.String(length=64), nullable=True),
        sa.Column("cost_center", sa.Unicode(length=300), nullable=True),
        sa.Column("company_id", sa.String(length=64), nullable=True),
        sa.Column("fee_item_id", sa.String(length=64), nullable=True),
        sa.Column("item_name", sa.Unicode(length=300), nullable=True),
        sa.Column("authority", sa.Unicode(length=300), nullable=True),
        sa.Column("stage", sa.String(length=60), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("planned", sa.Float(), nullable=True),
        sa.Column("actual", sa.Float(), nullable=True),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("done_date", sa.Date(), nullable=True),
        sa.Column("receipt_no", sa.Unicode(length=120), nullable=True),
        sa.ForeignKeyConstraint(["custody_id"], ["custodies.id"], name=op.f("fk_custody_lines_custody_id_custodies")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_custody_lines")),
    )
    op.create_index(op.f("ix_custody_lines_custody_id"), "custody_lines", ["custody_id"])
    op.create_index(op.f("ix_custody_lines_person_id"), "custody_lines", ["person_id"])
    op.bulk_insert(fee_items, [
        {"id": f"fee_{t}_{p}", "tx_type": t, "position": p, "name": n, "authority": a, "amount": amt, "options": o,
         "stage": st, "active": True} for t, p, n, a, amt, o, st in DEFAULT_FEES])
    _edit_roles(lambda keys: keys + [k for k in KEYS if k not in keys])


def downgrade() -> None:
    _edit_roles(lambda keys: [k for k in keys if k not in KEYS])
    op.drop_index(op.f("ix_custody_lines_person_id"), table_name="custody_lines")
    op.drop_index(op.f("ix_custody_lines_custody_id"), table_name="custody_lines")
    op.drop_table("custody_lines")
    op.drop_table("custodies")
    op.drop_index(op.f("ix_fee_items_tx_type"), table_name="fee_items")
    op.drop_table("fee_items")
