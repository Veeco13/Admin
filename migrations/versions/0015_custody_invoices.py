"""custody invoices — فواتير مراكز التكلفة + إذن عمل العمالة الوطنية

- invoices: فاتورة من الشركة المُصدِرة (أبراج انرجي) لكل مركز تكلفة في كل تقفيل عهدة: الرسوم الحكومية + الدعم
  الإداري (مرة لكل موظف، ومافيش دعم لمراكز تكلفة الشركة نفسها). رقمها INV-<السنة>-<مسلسل>، وحالتها
  pending (بانتظار موافقة الحسابات — التقفيل بيتلغي وهي بتتمسح) أو approved (اعتمدتها الحسابات — نهائية).
- fee_items: نوعين عهدة للعمالة الوطنية: إصدار إذن عمل (مترشّح كويتي) وتجديد إذن عمل (موظف كويتي) — 10 د.ك.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PAM = "الهيئة العامة للقوى العاملة"
KW_FEES = [
    {"id": "fee_kw_permit_new_1", "tx_type": "kw_permit_new", "position": 1, "name": "إصدار إذن العمل",
     "name_en": "Issuance of Work Permit", "authority": PAM, "amount": 10, "options": None, "stage": "kw_work_permit", "active": True},
    {"id": "fee_kw_permit_renewal_1", "tx_type": "kw_permit_renewal", "position": 1, "name": "تجديد إذن العمل",
     "name_en": "Renewal of Work Permit", "authority": PAM, "amount": 10, "options": None, "stage": "awaiting_work_permit",
     "active": True},
]


def upgrade() -> None:
    op.create_table(
        "invoices",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("no", sa.Integer(), nullable=False),
        sa.Column("custody_id", sa.String(length=64), nullable=False),
        sa.Column("closing_date", sa.Date(), nullable=False),
        sa.Column("cost_center", sa.Unicode(length=300), nullable=True),
        sa.Column("bill_company_id", sa.String(length=64), nullable=True),
        sa.Column("issuer_company_id", sa.String(length=64), nullable=True),
        sa.Column("employees", sa.Integer(), nullable=False),
        sa.Column("gov_amount", sa.Float(), nullable=False),
        sa.Column("support_fee", sa.Float(), nullable=False),
        sa.Column("support_amount", sa.Float(), nullable=False),
        sa.Column("total", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),        # pending | approved
        sa.Column("approved_date", sa.Date(), nullable=True),
        sa.Column("approved_by", sa.Unicode(length=300), nullable=True),
        sa.Column("created_by", sa.Unicode(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["custody_id"], ["custodies.id"], name=op.f("fk_invoices_custody_id_custodies")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invoices")),
        sa.UniqueConstraint("year", "no", name=op.f("uq_invoices_year_no")),
    )
    op.create_index(op.f("ix_invoices_custody_id"), "invoices", ["custody_id"])
    fee_items = sa.table("fee_items", *(sa.column(k) for k in KW_FEES[0]))
    op.bulk_insert(fee_items, KW_FEES)


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM fee_items WHERE tx_type IN ('kw_permit_new', 'kw_permit_renewal')"))
    op.drop_index(op.f("ix_invoices_custody_id"), table_name="invoices")
    op.drop_table("invoices")
