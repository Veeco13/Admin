"""custody closing — تقفيل العهد وكشوفها

- fee_items.name_en / custody_lines.item_name_en: اسم البند بالإنجليزي (الكشوف ثنائية اللغة بتروح لمراكز التكلفة).
- custody_lines.closed_date: الشخص اتقفل في كشف بتاريخ ده (مابيتعدّلش بعدها، وبيتنزّل تاني بنفس التاريخ).
- custodies.admin_fee: رسوم الدعم الإداري لكل شخص في كشف التقفيل (مش من فلوس العهدة — بتتحسب على مركز التكلفة).

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NAMES_EN = {
    "fee_renewal_1": "Renewal of Work Permit", "fee_renewal_2": "Renewal of Health Insurance",
    "fee_renewal_3": "Renewal of Residency", "fee_renewal_4": "Renewal of Civil ID",
    "fee_transfer_in_1": "Issuance of Work Permit", "fee_transfer_in_2": "Issuance of Health Insurance",
    "fee_transfer_in_3": "Transfer of Residency", "fee_transfer_in_4": "Renewal of Civil ID",
    "fee_transfer_out_1": "Issuance of Work Permit", "fee_transfer_out_2": "Issuance of Health Insurance",
    "fee_transfer_out_3": "Transfer of Residency", "fee_transfer_out_4": "Renewal of Civil ID",
    "fee_visa_1": "Issuance of Work Visa",
    "fee_first_residency_1": "Medical Examination", "fee_first_residency_2": "Documentation Stamp (Attestation)",
    "fee_first_residency_3": "Issuance of Work Permit", "fee_first_residency_4": "Issuance of Health Insurance",
    "fee_first_residency_5": "Issuance of Residency", "fee_first_residency_6": "Issuance of Civil ID",
}


def upgrade() -> None:
    with op.batch_alter_table("fee_items") as batch:
        batch.add_column(sa.Column("name_en", sa.Unicode(length=300), nullable=True))
    with op.batch_alter_table("custody_lines") as batch:
        batch.add_column(sa.Column("item_name_en", sa.Unicode(length=300), nullable=True))
        batch.add_column(sa.Column("closed_date", sa.Date(), nullable=True))
    with op.batch_alter_table("custodies") as batch:
        batch.add_column(sa.Column("admin_fee", sa.Float(), nullable=True))
    conn = op.get_bind()
    for fid, name in NAMES_EN.items():
        conn.execute(sa.text("UPDATE fee_items SET name_en = :n WHERE id = :i"), {"n": name, "i": fid})
        conn.execute(sa.text("UPDATE custody_lines SET item_name_en = :n WHERE fee_item_id = :i"), {"n": name, "i": fid})


def downgrade() -> None:
    with op.batch_alter_table("custodies") as batch:
        batch.drop_column("admin_fee")
    with op.batch_alter_table("custody_lines") as batch:
        batch.drop_column("closed_date")
        batch.drop_column("item_name_en")
    with op.batch_alter_table("fee_items") as batch:
        batch.drop_column("name_en")
