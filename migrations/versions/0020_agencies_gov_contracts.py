"""agencies + government contracts — الوكالات والعقود والمشاريع الحكومية (للموظفين والسيارات)

- agencies: وكالات الشركة (أبراج انرجي وكيلة لـ Superior و Scomi)، و agency_cost_centers: مراكز التكلفة التابعة
  لكل وكالة (للمقارنة والتقارير بس — مراكز التكلفة نفسها مابتتغيّرش).
- projects: النوع (main ترخيص رئيسي / gov عقد حكومي)، رقم العقد، الوكالة، تاريخ البداية. file_number = الرقم
  المدني للترخيص (زي ما هو)، و expiry_date = نهاية الترخيص.
- vehicles: العقد / المشروع المسجّلة عليه (project_id)، مركز التكلفة (مكان الشغل الفعلي — بالاسم زي الموظف)، ونوع المركبة.
البيانات الأولى من تفاصيل تراخيص الهيئة (ملف 100100253): الترخيص الرئيسي 3563650 والست عقود الحكومية.

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# الرقم المدني للترخيص ← (النوع، الوكالة، رقم العقد، البداية، النهاية)
LICENSES = {
    "3563650": ("main", None, None, "2026-03-24", "2030-03-23"),
    "312201900111": ("gov", "superior", "18053175", "2019-03-18", "2027-03-03"),
    "312201900112": ("gov", "superior", "19053598", "2019-03-19", "2027-03-03"),
    "900000430030": ("gov", "superior", "26064547", "2026-07-06", "2031-07-28"),
    "900000429614": ("gov", "superior", "26064556", "2026-07-06", "2031-07-28"),
    "312201900166": ("gov", "scomi", "18053383", "2019-12-24", "2027-01-09"),
    "312201900167": ("gov", "scomi", "18053124", "2019-12-24", "2027-07-08"),
}
AGENCIES = {"superior": ("سوبيرور", "Superior", 1, ("SUP",)), "scomi": ("سكومي", "Scomi", 2, ("SCO", "SMP"))}


def upgrade() -> None:
    op.create_table(
        "agencies",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("company_id", sa.String(length=64), nullable=True),
        sa.Column("name_ar", sa.Unicode(length=300), nullable=False),
        sa.Column("name_en", sa.Unicode(length=300), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name=op.f("fk_agencies_company_id_companies")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agencies")),
    )
    op.create_index(op.f("ix_agencies_company_id"), "agencies", ["company_id"])
    op.create_table(
        "agency_cost_centers",
        sa.Column("agency_id", sa.String(length=64), nullable=False),
        sa.Column("cost_center_id", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["agency_id"], ["agencies.id"], name=op.f("fk_agency_cost_centers_agency_id_agencies")),
        sa.ForeignKeyConstraint(["cost_center_id"], ["cost_centers.id"], name=op.f("fk_agency_cost_centers_cost_center_id_cost_centers")),
        sa.PrimaryKeyConstraint("agency_id", "cost_center_id", name=op.f("pk_agency_cost_centers")),
    )
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("kind", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("contract_no", sa.Unicode(length=120), nullable=True))
        batch.add_column(sa.Column("agency_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("start_date", sa.Date(), nullable=True))
        batch.create_foreign_key(op.f("fk_projects_agency_id_agencies"), "agencies", ["agency_id"], ["id"])
    with op.batch_alter_table("vehicles") as batch:
        batch.add_column(sa.Column("project_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("cost_center", sa.Unicode(length=300), nullable=True))
        batch.add_column(sa.Column("vehicle_type", sa.String(length=20), nullable=True))
        batch.create_foreign_key(op.f("fk_vehicles_project_id_projects"), "projects", ["project_id"], ["id"])

    conn = op.get_bind()
    rows = {r[1]: (r[0], r[2]) for r in conn.execute(sa.text("SELECT id, file_number, company_id FROM projects")).fetchall() if r[1]}
    owner = next((rows[k][1] for k in LICENSES if k in rows and LICENSES[k][0] == "gov"), None)
    if owner is None:                        # قاعدة جديدة من غير العقود دي
        return
    for key, (ar, en, pos, codes) in AGENCIES.items():
        aid = f"ag_{key}"
        conn.execute(sa.text("INSERT INTO agencies (id, company_id, name_ar, name_en, position) VALUES (:i, :c, :a, :e, :p)"),
                     {"i": aid, "c": owner, "a": ar, "e": en, "p": pos})
        for code in codes:
            cc = conn.execute(sa.text("SELECT id FROM cost_centers WHERE code = :c"), {"c": code}).scalar()
            if cc:
                conn.execute(sa.text("INSERT INTO agency_cost_centers (agency_id, cost_center_id) VALUES (:a, :c)"), {"a": aid, "c": cc})
    for civil, (kind, agency, contract, start, end) in LICENSES.items():
        if civil in rows:
            conn.execute(sa.text("UPDATE projects SET kind = :k, agency_id = :a, contract_no = :n, start_date = :s, expiry_date = :e "
                                 "WHERE id = :i"),
                         {"k": kind, "a": f"ag_{agency}" if agency else None, "n": contract, "s": start, "e": end, "i": rows[civil][0]})


def downgrade() -> None:
    with op.batch_alter_table("vehicles") as batch:
        batch.drop_constraint("fk_vehicles_project_id_projects", type_="foreignkey")
        batch.drop_column("vehicle_type")
        batch.drop_column("cost_center")
        batch.drop_column("project_id")
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("fk_projects_agency_id_agencies", type_="foreignkey")
        batch.drop_column("start_date")
        batch.drop_column("agency_id")
        batch.drop_column("contract_no")
        batch.drop_column("kind")
    op.drop_table("agency_cost_centers")
    op.drop_index(op.f("ix_agencies_company_id"), table_name="agencies")
    op.drop_table("agencies")
