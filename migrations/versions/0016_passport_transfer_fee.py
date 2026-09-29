"""custody: نقل بيانات الجواز — رسوم البطاقة المدنية 5 د.ك

نوع عهدة جديد (custody.TX_TYPES["passport_transfer"]) للموظف اللي جدد جوازه: بند واحد «رسوم البطاقة المدنية»
من غير مرحلة (بيتعلّم «تم» يدوي من تفاصيل العهدة).

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FEES = [
    {"id": "fee_passport_transfer_1", "tx_type": "passport_transfer", "position": 1, "name": "رسوم البطاقة المدنية",
     "name_en": "Civil ID Fees", "authority": "الهيئة العامة للمعلومات المدنية", "amount": 5, "options": None, "stage": None,
     "active": True},
]


def upgrade() -> None:
    fee_items = sa.table("fee_items", *(sa.column(k) for k in FEES[0]))
    op.bulk_insert(fee_items, FEES)


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM fee_items WHERE tx_type = 'passport_transfer'"))
