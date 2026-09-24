"""initial schema — هيكل الإصدار v353-flask.2 (بدون مفاتيح أجنبية)

Revision ID: 0001
Revises: 
Create Date: 2026-09-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('audit_log',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('type', sa.String(length=60), nullable=True),
    sa.Column('category', sa.String(length=40), nullable=True),
    sa.Column('label', sa.UnicodeText(), nullable=True),
    sa.Column('date', sa.DateTime(), nullable=True),
    sa.Column('user', sa.Unicode(length=300), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_log'))
    )
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_audit_log_category'), ['category'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_log_date'), ['date'], unique=False)

    op.create_table('companies',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name_ar', sa.Unicode(length=300), nullable=False),
    sa.Column('name_en', sa.Unicode(length=300), nullable=True),
    sa.Column('labor_office', sa.Unicode(length=300), nullable=True),
    sa.Column('main_file_number', sa.Unicode(length=120), nullable=True),
    sa.Column('commercial_license_no', sa.Unicode(length=120), nullable=True),
    sa.Column('commercial_license_expiry', sa.Date(), nullable=True),
    sa.Column('license_civil_no', sa.Unicode(length=120), nullable=True),
    sa.Column('traffic_auth_expiry', sa.Date(), nullable=True),
    sa.Column('civil_affairs_auth_expiry', sa.Date(), nullable=True),
    sa.Column('activity', sa.Unicode(length=300), nullable=True),
    sa.Column('logo_path', sa.Unicode(length=500), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_companies'))
    )
    op.create_table('company_history',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('company_id', sa.String(length=64), nullable=True),
    sa.Column('type', sa.String(length=60), nullable=True),
    sa.Column('label', sa.UnicodeText(), nullable=True),
    sa.Column('date', sa.DateTime(), nullable=True),
    sa.Column('user', sa.Unicode(length=300), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_company_history'))
    )
    with op.batch_alter_table('company_history', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_company_history_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_company_history_date'), ['date'], unique=False)

    op.create_table('cost_centers',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.Unicode(length=300), nullable=False),
    sa.Column('name_en', sa.Unicode(length=300), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cost_centers')),
    sa.UniqueConstraint('name', name=op.f('uq_cost_centers_name'))
    )
    op.create_table('employee_files',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('employee_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.Unicode(length=500), nullable=True),
    sa.Column('path', sa.Unicode(length=500), nullable=True),
    sa.Column('size', sa.Integer(), nullable=True),
    sa.Column('uploaded_at', sa.DateTime(), nullable=True),
    sa.Column('uploaded_by', sa.Unicode(length=300), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_employee_files'))
    )
    with op.batch_alter_table('employee_files', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_employee_files_employee_id'), ['employee_id'], unique=False)

    op.create_table('employee_timeline',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('employee_id', sa.String(length=64), nullable=True),
    sa.Column('type', sa.String(length=60), nullable=True),
    sa.Column('label', sa.UnicodeText(), nullable=True),
    sa.Column('date', sa.DateTime(), nullable=True),
    sa.Column('user', sa.Unicode(length=300), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_employee_timeline'))
    )
    with op.batch_alter_table('employee_timeline', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_employee_timeline_employee_id'), ['employee_id'], unique=False)

    op.create_table('employees',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.Unicode(length=300), nullable=False),
    sa.Column('name_en', sa.Unicode(length=300), nullable=True),
    sa.Column('nationality', sa.Unicode(length=120), nullable=True),
    sa.Column('nationality_en', sa.Unicode(length=120), nullable=True),
    sa.Column('profession', sa.Unicode(length=300), nullable=True),
    sa.Column('profession_en', sa.Unicode(length=300), nullable=True),
    sa.Column('date_of_birth', sa.Date(), nullable=True),
    sa.Column('date_of_hire', sa.Date(), nullable=True),
    sa.Column('salary', sa.Float(), nullable=True),
    sa.Column('housing_included', sa.Boolean(), nullable=False),
    sa.Column('housing_amount', sa.Float(), nullable=True),
    sa.Column('employment_status', sa.String(length=40), nullable=True),
    sa.Column('contract_type', sa.Unicode(length=120), nullable=True),
    sa.Column('residency_exp', sa.Date(), nullable=True),
    sa.Column('work_permit_exp', sa.Date(), nullable=True),
    sa.Column('work_permit_issue', sa.Date(), nullable=True),
    sa.Column('passport_no', sa.Unicode(length=120), nullable=True),
    sa.Column('passport_exp', sa.Date(), nullable=True),
    sa.Column('health_card_exp', sa.Date(), nullable=True),
    sa.Column('is_driver', sa.Boolean(), nullable=False),
    sa.Column('driving_license_exp', sa.Date(), nullable=True),
    sa.Column('cost_center', sa.Unicode(length=300), nullable=True),
    sa.Column('actual_workplace', sa.Unicode(length=300), nullable=True),
    sa.Column('file_no', sa.Unicode(length=120), nullable=True),
    sa.Column('gov_stage', sa.String(length=60), nullable=True),
    sa.Column('gov_stage_note', sa.UnicodeText(), nullable=True),
    sa.Column('gov_stage_responsible', sa.Unicode(length=300), nullable=True),
    sa.Column('gov_stage_start_date', sa.Date(), nullable=True),
    sa.Column('gov_transaction_cost', sa.Float(), nullable=True),
    sa.Column('transfer_note', sa.UnicodeText(), nullable=True),
    sa.Column('bank', sa.Unicode(length=300), nullable=True),
    sa.Column('iban', sa.Unicode(length=120), nullable=True),
    sa.Column('dp_id', sa.Unicode(length=120), nullable=True),
    sa.Column('phone', sa.Unicode(length=120), nullable=True),
    sa.Column('notes', sa.UnicodeText(), nullable=True),
    sa.Column('last_updated', sa.DateTime(), nullable=True),
    sa.Column('last_updated_by', sa.Unicode(length=300), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_employees'))
    )
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_employees_passport_no'), ['passport_no'], unique=False)

    op.create_table('meta',
    sa.Column('key', sa.String(length=100), nullable=False),
    sa.Column('value', sa.UnicodeText(), nullable=True),
    sa.PrimaryKeyConstraint('key', name=op.f('pk_meta'))
    )
    op.create_table('signatory_docs',
    sa.Column('civil_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.Unicode(length=500), nullable=True),
    sa.Column('path', sa.Unicode(length=500), nullable=True),
    sa.Column('expiry_date', sa.Date(), nullable=True),
    sa.Column('uploaded_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('civil_id', name=op.f('pk_signatory_docs'))
    )
    op.create_table('templates',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.Unicode(length=300), nullable=False),
    sa.Column('filename', sa.Unicode(length=500), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_templates'))
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('username', sa.Unicode(length=120), nullable=False),
    sa.Column('display_name', sa.Unicode(length=300), nullable=True),
    sa.Column('password_hash', sa.String(length=300), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('username', name=op.f('uq_users_username'))
    )
    op.create_table('candidates',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.Unicode(length=300), nullable=False),
    sa.Column('name_en', sa.Unicode(length=300), nullable=True),
    sa.Column('nationality', sa.Unicode(length=120), nullable=True),
    sa.Column('date_of_birth', sa.Date(), nullable=True),
    sa.Column('profession', sa.Unicode(length=300), nullable=True),
    sa.Column('phone', sa.Unicode(length=120), nullable=True),
    sa.Column('salary', sa.Float(), nullable=True),
    sa.Column('housing_allowance', sa.Boolean(), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=True),
    sa.Column('stage', sa.String(length=60), nullable=True),
    sa.Column('applied_date', sa.Date(), nullable=True),
    sa.Column('passport_no', sa.Unicode(length=120), nullable=True),
    sa.Column('passport_issue_date', sa.Date(), nullable=True),
    sa.Column('passport_exp', sa.Date(), nullable=True),
    sa.Column('visa_issue_date', sa.Date(), nullable=True),
    sa.Column('visa_exp', sa.Date(), nullable=True),
    sa.Column('entry_date', sa.Date(), nullable=True),
    sa.Column('old_sponsor_residency_exp', sa.Date(), nullable=True),
    sa.Column('civil_id', sa.String(length=64), nullable=True),
    sa.Column('target_company_id', sa.String(length=64), nullable=True),
    sa.Column('cost_center', sa.Unicode(length=300), nullable=True),
    sa.Column('notes', sa.UnicodeText(), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_candidates'))
    )
    with op.batch_alter_table('candidates', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_candidates_civil_id'), ['civil_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_candidates_passport_no'), ['passport_no'], unique=False)

    op.create_table('company_docs',
    sa.Column('company_id', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('name', sa.Unicode(length=500), nullable=True),
    sa.Column('path', sa.Unicode(length=500), nullable=True),
    sa.Column('uploaded_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('company_id', 'kind', name=op.f('pk_company_docs'))
    )
    op.create_table('projects',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('company_id', sa.String(length=64), nullable=True),
    sa.Column('name_ar', sa.Unicode(length=300), nullable=False),
    sa.Column('name_en', sa.Unicode(length=300), nullable=True),
    sa.Column('file_number', sa.Unicode(length=120), nullable=True),
    sa.Column('labor_office', sa.Unicode(length=300), nullable=True),
    sa.Column('expiry_date', sa.Date(), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_projects'))
    )
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_projects_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_projects_file_number'), ['file_number'], unique=False)

    op.create_table('signatories',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('company_id', sa.String(length=64), nullable=False),
    sa.Column('name_ar', sa.Unicode(length=300), nullable=False),
    sa.Column('name_en', sa.Unicode(length=300), nullable=True),
    sa.Column('civil_id', sa.String(length=64), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_signatories'))
    )
    with op.batch_alter_table('signatories', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_signatories_company_id'), ['company_id'], unique=False)

    op.create_table('vehicles',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('plate', sa.Unicode(length=120), nullable=False),
    sa.Column('model', sa.Unicode(length=300), nullable=True),
    sa.Column('company_id', sa.String(length=64), nullable=True),
    sa.Column('driver_id', sa.String(length=64), nullable=True),
    sa.Column('insurance_expiry', sa.Date(), nullable=True),
    sa.Column('gov_license_expiry', sa.Date(), nullable=True),
    sa.Column('notes', sa.UnicodeText(), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_vehicles')),
    sa.UniqueConstraint('plate', name=op.f('uq_vehicles_plate'))
    )
    op.create_table('employee_affiliations',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.String(length=64), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('company_id', sa.String(length=64), nullable=True),
    sa.Column('project_id', sa.String(length=64), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_employee_affiliations'))
    )
    with op.batch_alter_table('employee_affiliations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_employee_affiliations_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_employee_affiliations_employee_id'), ['employee_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_employee_affiliations_project_id'), ['project_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('employee_affiliations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_employee_affiliations_project_id'))
        batch_op.drop_index(batch_op.f('ix_employee_affiliations_employee_id'))
        batch_op.drop_index(batch_op.f('ix_employee_affiliations_company_id'))

    op.drop_table('employee_affiliations')
    op.drop_table('vehicles')
    with op.batch_alter_table('signatories', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_signatories_company_id'))

    op.drop_table('signatories')
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_projects_file_number'))
        batch_op.drop_index(batch_op.f('ix_projects_company_id'))

    op.drop_table('projects')
    op.drop_table('company_docs')
    with op.batch_alter_table('candidates', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_candidates_passport_no'))
        batch_op.drop_index(batch_op.f('ix_candidates_civil_id'))

    op.drop_table('candidates')
    op.drop_table('users')
    op.drop_table('templates')
    op.drop_table('signatory_docs')
    op.drop_table('meta')
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_employees_passport_no'))

    op.drop_table('employees')
    with op.batch_alter_table('employee_timeline', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_employee_timeline_employee_id'))

    op.drop_table('employee_timeline')
    with op.batch_alter_table('employee_files', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_employee_files_employee_id'))

    op.drop_table('employee_files')
    op.drop_table('cost_centers')
    with op.batch_alter_table('company_history', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_company_history_date'))
        batch_op.drop_index(batch_op.f('ix_company_history_company_id'))

    op.drop_table('company_history')
    op.drop_table('companies')
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_audit_log_date'))
        batch_op.drop_index(batch_op.f('ix_audit_log_category'))

    op.drop_table('audit_log')
