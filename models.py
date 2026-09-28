# -*- coding: utf-8 -*-
"""
Lunx — نماذج قاعدة البيانات (SQLAlchemy 2.x ORM)

- أسماء الخصائص في بايثون = أسماء الحقول في الـ API (camelCase).
- أسماء الأعمدة في قاعدة البيانات snake_case (زي ما هي من الأول، فالنسخ القديمة متوافقة).
- الأنواع محايدة: Unicode/UnicodeText/String/Date/DateTime/Boolean/Float/Integer
  ← تشتغل على SQLite و PostgreSQL و MySQL/MariaDB و SQL Server من غير تعديل.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Unicode, UnicodeText
from sqlalchemy import MetaData, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


# أسماء ثابتة للقيود والفهارس ← لازمة لـ Alembic عشان التعديلات تشتغل بنفس الشكل على كل الأنواع
NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


ID = String(64)          # معرّفات نصية (c1, cand_xxx, الرقم المدني …)
NAME = Unicode(300)       # Unicode ← NVARCHAR على SQL Server (عربي سليم)، VARCHAR على الباقي
SHORT = Unicode(120)
TEXT = UnicodeText()


def col(name, type_, *args, **kw):
    return mapped_column(name, type_, *args, **kw)


def fk(target):
    """مفتاح أجنبي بدون ON DELETE/UPDATE (NO ACTION) — محمول على كل الأنواع حتى SQL Server.
    الحذف والتغيير بيتعاملوا من كود التطبيق بترتيب صحيح."""
    return ForeignKey(target, name=None)


# ---------------------------------------------------------------------------
# الكيانات الأساسية (القسم 6 في الوثيقة)
# ---------------------------------------------------------------------------
class Company(Base):
    __tablename__ = "companies"
    id: Mapped[str] = col("id", ID, primary_key=True)
    nameAr: Mapped[str] = col("name_ar", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    laborOffice: Mapped[Optional[str]] = col("labor_office", NAME)
    mainFileNumber: Mapped[Optional[str]] = col("main_file_number", SHORT)
    commercialLicenseNo: Mapped[Optional[str]] = col("commercial_license_no", SHORT)
    commercialLicenseExpiry: Mapped[Optional[date]] = col("commercial_license_expiry", Date)
    licenseCivilNo: Mapped[Optional[str]] = col("license_civil_no", SHORT)
    unifiedNumber: Mapped[Optional[str]] = col("unified_number", SHORT)        # الرقم الموحد للشركة
    pifssNo: Mapped[Optional[str]] = col("pifss_no", SHORT)                    # رقم التسجيل في التأمينات الاجتماعية
    trafficAuthExpiry: Mapped[Optional[date]] = col("traffic_auth_expiry", Date)
    civilAffairsAuthExpiry: Mapped[Optional[date]] = col("civil_affairs_auth_expiry", Date)
    activity: Mapped[Optional[str]] = col("activity", NAME)
    logoPath: Mapped[Optional[str]] = col("logo_path", Unicode(500))


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = col("id", ID, primary_key=True)
    companyId: Mapped[Optional[str]] = col("company_id", ID, fk("companies.id"), index=True)
    nameAr: Mapped[str] = col("name_ar", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    fileNumber: Mapped[Optional[str]] = col("file_number", SHORT, index=True)
    laborOffice: Mapped[Optional[str]] = col("labor_office", NAME)
    expiryDate: Mapped[Optional[date]] = col("expiry_date", Date)


class CostCenter(Base):
    __tablename__ = "cost_centers"
    id: Mapped[str] = col("id", ID, primary_key=True)
    name: Mapped[str] = col("name", NAME, nullable=False, unique=True)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    # الشركة اللي موظفين المركز شغالين فيها فعلًا (ممكن تختلف عن الشركة المسجّلين عليها) ← بتدخل في نطاق الشركات
    companyId: Mapped[Optional[str]] = col("company_id", ID, fk("companies.id"), index=True)


class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[str] = col("id", ID, primary_key=True)
    plate: Mapped[str] = col("plate", SHORT, nullable=False, unique=True)
    model: Mapped[Optional[str]] = col("model", NAME)
    companyId: Mapped[Optional[str]] = col("company_id", ID, fk("companies.id"))
    driverId: Mapped[Optional[str]] = col("driver_id", ID, fk("employees.id"))
    insuranceExpiry: Mapped[Optional[date]] = col("insurance_expiry", Date)
    govLicenseExpiry: Mapped[Optional[date]] = col("gov_license_expiry", Date)
    notes: Mapped[Optional[str]] = col("notes", TEXT)


class Employee(Base):
    __tablename__ = "employees"
    id: Mapped[str] = col("id", ID, primary_key=True)                 # الرقم المدني
    name: Mapped[str] = col("name", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    nationality: Mapped[Optional[str]] = col("nationality", SHORT)
    nationalityEn: Mapped[Optional[str]] = col("nationality_en", SHORT)
    profession: Mapped[Optional[str]] = col("profession", NAME)
    professionEn: Mapped[Optional[str]] = col("profession_en", NAME)
    dateOfBirth: Mapped[Optional[date]] = col("date_of_birth", Date)
    gender: Mapped[Optional[str]] = col("gender", String(10))                  # male | female
    placeOfBirth: Mapped[Optional[str]] = col("place_of_birth", NAME)
    unifiedNumber: Mapped[Optional[str]] = col("unified_number", SHORT)        # الرقم الموحد (مرجع الداخلية)
    bloodType: Mapped[Optional[str]] = col("blood_type", String(4))              # A+ … AB-
    # عنوان السكن + هاتف المنزل (نموذج رخصة القيادة)
    addressArea: Mapped[Optional[str]] = col("address_area", NAME)
    addressBlock: Mapped[Optional[str]] = col("address_block", SHORT)
    addressStreet: Mapped[Optional[str]] = col("address_street", NAME)
    addressHouse: Mapped[Optional[str]] = col("address_house", SHORT)
    addressApartment: Mapped[Optional[str]] = col("address_apartment", SHORT)
    homePhone: Mapped[Optional[str]] = col("home_phone", SHORT)
    email: Mapped[Optional[str]] = col("email", SHORT)
    # العمالة الوطنية (استمارة 103 للتأمينات واستمارة العلاوة الاجتماعية)
    maritalStatus: Mapped[Optional[str]] = col("marital_status", String(20))    # single | married | divorced | widowed
    qualification: Mapped[Optional[str]] = col("qualification", SHORT)
    specialization: Mapped[Optional[str]] = col("specialization", NAME)
    naturalizationDate: Mapped[Optional[date]] = col("naturalization_date", Date)
    citizenshipArticle: Mapped[Optional[str]] = col("citizenship_article", SHORT)    # مادة الجنسية (الأولى …)
    nationalityNo: Mapped[Optional[str]] = col("nationality_no", SHORT)              # رقم الجنسية
    studyInstitution: Mapped[Optional[str]] = col("study_institution", NAME)         # جهة الدراسة الحالية (فاضي = مش بيدرس)
    studyAbroad: Mapped[Optional[bool]] = col("study_abroad", Boolean)
    studyStartDate: Mapped[Optional[date]] = col("study_start_date", Date)
    # الأبناء: JSON [{name, dateOfBirth, disabled, disabilityDegree, working, married}] ← db.children_json
    children: Mapped[Optional[str]] = col("children", TEXT)
    dateOfHire: Mapped[Optional[date]] = col("date_of_hire", Date)
    serviceEndDate: Mapped[Optional[date]] = col("service_end_date", Date)      # آخر يوم عمل (إقرار المخالصة)
    salary: Mapped[Optional[float]] = col("salary", Float)
    housingIncluded: Mapped[bool] = col("housing_included", Boolean, default=False)
    housingAmount: Mapped[Optional[float]] = col("housing_amount", Float)
    employmentStatus: Mapped[Optional[str]] = col("employment_status", String(40), default="active")
    contractType: Mapped[Optional[str]] = col("contract_type", SHORT)
    residencyExp: Mapped[Optional[date]] = col("residency_exp", Date)
    workPermitExp: Mapped[Optional[date]] = col("work_permit_exp", Date)
    workPermitIssue: Mapped[Optional[date]] = col("work_permit_issue", Date)
    passportNo: Mapped[Optional[str]] = col("passport_no", SHORT, index=True)
    passportIssueDate: Mapped[Optional[date]] = col("passport_issue_date", Date)
    passportExp: Mapped[Optional[date]] = col("passport_exp", Date)
    healthCardExp: Mapped[Optional[date]] = col("health_card_exp", Date)
    isDriver: Mapped[bool] = col("is_driver", Boolean, default=False)
    drivingLicenseExp: Mapped[Optional[date]] = col("driving_license_exp", Date)
    costCenter: Mapped[Optional[str]] = col("cost_center", NAME)
    actualWorkplace: Mapped[Optional[str]] = col("actual_workplace", NAME)
    fileNo: Mapped[Optional[str]] = col("file_no", SHORT)
    govStage: Mapped[Optional[str]] = col("gov_stage", String(60))
    govStageNote: Mapped[Optional[str]] = col("gov_stage_note", TEXT)
    govStageResponsible: Mapped[Optional[str]] = col("gov_stage_responsible", NAME)
    govStageStartDate: Mapped[Optional[date]] = col("gov_stage_start_date", Date)
    govTransactionCost: Mapped[Optional[float]] = col("gov_transaction_cost", Float)
    transferNote: Mapped[Optional[str]] = col("transfer_note", TEXT)
    bank: Mapped[Optional[str]] = col("bank", NAME)
    iban: Mapped[Optional[str]] = col("iban", SHORT)
    dpId: Mapped[Optional[str]] = col("dp_id", SHORT)
    phone: Mapped[Optional[str]] = col("phone", SHORT)
    notes: Mapped[Optional[str]] = col("notes", TEXT)
    lastUpdated: Mapped[Optional[datetime]] = col("last_updated", DateTime)
    lastUpdatedBy: Mapped[Optional[str]] = col("last_updated_by", NAME)


class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[str] = col("id", ID, primary_key=True)
    name: Mapped[str] = col("name", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    nationality: Mapped[Optional[str]] = col("nationality", SHORT)
    dateOfBirth: Mapped[Optional[date]] = col("date_of_birth", Date)
    profession: Mapped[Optional[str]] = col("profession", NAME)
    phone: Mapped[Optional[str]] = col("phone", SHORT)
    gender: Mapped[Optional[str]] = col("gender", String(10))                  # male | female
    unifiedNumber: Mapped[Optional[str]] = col("unified_number", SHORT)        # الرقم الموحد (مرجع الداخلية)
    bloodType: Mapped[Optional[str]] = col("blood_type", String(4))              # A+ … AB-
    # عنوان السكن + هاتف المنزل (نموذج رخصة القيادة)
    addressArea: Mapped[Optional[str]] = col("address_area", NAME)
    addressBlock: Mapped[Optional[str]] = col("address_block", SHORT)
    addressStreet: Mapped[Optional[str]] = col("address_street", NAME)
    addressHouse: Mapped[Optional[str]] = col("address_house", SHORT)
    addressApartment: Mapped[Optional[str]] = col("address_apartment", SHORT)
    homePhone: Mapped[Optional[str]] = col("home_phone", SHORT)
    email: Mapped[Optional[str]] = col("email", SHORT)
    # العمالة الوطنية (نفس الموظف — بتتنقل معاه عند التحويل)
    maritalStatus: Mapped[Optional[str]] = col("marital_status", String(20))
    qualification: Mapped[Optional[str]] = col("qualification", SHORT)
    specialization: Mapped[Optional[str]] = col("specialization", NAME)
    naturalizationDate: Mapped[Optional[date]] = col("naturalization_date", Date)
    citizenshipArticle: Mapped[Optional[str]] = col("citizenship_article", SHORT)
    nationalityNo: Mapped[Optional[str]] = col("nationality_no", SHORT)
    studyInstitution: Mapped[Optional[str]] = col("study_institution", NAME)
    studyAbroad: Mapped[Optional[bool]] = col("study_abroad", Boolean)
    studyStartDate: Mapped[Optional[date]] = col("study_start_date", Date)
    children: Mapped[Optional[str]] = col("children", TEXT)
    salary: Mapped[Optional[float]] = col("salary", Float)
    housingAllowance: Mapped[bool] = col("housing_allowance", Boolean, default=False)
    source: Mapped[Optional[str]] = col("source", String(20), default="outside")     # outside | internal | kuwaiti
    stage: Mapped[Optional[str]] = col("stage", String(60))
    appliedDate: Mapped[Optional[date]] = col("applied_date", Date)
    passportNo: Mapped[Optional[str]] = col("passport_no", SHORT, index=True)
    passportIssueDate: Mapped[Optional[date]] = col("passport_issue_date", Date)
    passportExp: Mapped[Optional[date]] = col("passport_exp", Date)
    visaIssueDate: Mapped[Optional[date]] = col("visa_issue_date", Date)
    visaExp: Mapped[Optional[date]] = col("visa_exp", Date)
    entryDate: Mapped[Optional[date]] = col("entry_date", Date)
    oldSponsorResidencyExp: Mapped[Optional[date]] = col("old_sponsor_residency_exp", Date)
    civilId: Mapped[Optional[str]] = col("civil_id", ID, index=True)
    targetCompanyId: Mapped[Optional[str]] = col("target_company_id", ID, fk("companies.id"))
    costCenter: Mapped[Optional[str]] = col("cost_center", NAME)
    notes: Mapped[Optional[str]] = col("notes", TEXT)


class Signatory(Base):
    __tablename__ = "signatories"
    id: Mapped[str] = col("id", ID, primary_key=True)
    companyId: Mapped[str] = col("company_id", ID, fk("companies.id"), nullable=False, index=True)
    nameAr: Mapped[str] = col("name_ar", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    civilId: Mapped[Optional[str]] = col("civil_id", ID)
    title: Mapped[Optional[str]] = col("title", NAME)                          # المسمى الوظيفي (إقرار استمارة 103)


class Template(Base):
    __tablename__ = "templates"
    id: Mapped[str] = col("id", ID, primary_key=True)
    name: Mapped[str] = col("name", NAME, nullable=False)
    filename: Mapped[str] = col("filename", Unicode(500), nullable=False)
    isDefault: Mapped[bool] = col("is_default", Boolean, default=False)
    createdAt: Mapped[Optional[datetime]] = col("created_at", DateTime)


# ---------------------------------------------------------------------------
# الجداول المساعدة
# ---------------------------------------------------------------------------
class Meta(Base):
    __tablename__ = "meta"
    key: Mapped[str] = col("key", String(100), primary_key=True)
    value: Mapped[Optional[str]] = col("value", TEXT)


class Role(Base):
    """دور وظيفي بصلاحيات قابلة للتعديل (مدير النظام، موارد بشرية، مندوب حكومي …).
    permissions = JSON: قائمة مفاتيح زي ["employees.view", "employees.edit", "sensitive.salary"] — الكتالوج في perms.py"""
    __tablename__ = "roles"
    id: Mapped[str] = col("id", ID, primary_key=True)
    name: Mapped[str] = col("name", NAME, nullable=False, unique=True)
    description: Mapped[Optional[str]] = col("description", TEXT)
    permissions: Mapped[Optional[str]] = col("permissions", TEXT)
    isAdmin: Mapped[bool] = col("is_admin", Boolean, nullable=False, default=False)   # كل الصلاحيات وكل الشركات
    isSystem: Mapped[bool] = col("is_system", Boolean, nullable=False, default=False)  # مايتحذفش


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = col("id", Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = col("username", SHORT, nullable=False, unique=True)
    displayName: Mapped[Optional[str]] = col("display_name", NAME)
    passwordHash: Mapped[str] = col("password_hash", String(300), nullable=False)
    roleId: Mapped[Optional[str]] = col("role_id", ID, fk("roles.id"), index=True)
    allCompanies: Mapped[bool] = col("all_companies", Boolean, nullable=False, default=True)  # لأ ← user_companies بس
    active: Mapped[bool] = col("active", Boolean, nullable=False, default=True)
    jobTitle: Mapped[Optional[str]] = col("job_title", NAME)
    email: Mapped[Optional[str]] = col("email", SHORT)
    phone: Mapped[Optional[str]] = col("phone", SHORT)
    lastLogin: Mapped[Optional[datetime]] = col("last_login", DateTime)
    createdAt: Mapped[Optional[datetime]] = col("created_at", DateTime)


class UserCompany(Base):
    """نطاق الشركات للمستخدم (لو all_companies = False)."""
    __tablename__ = "user_companies"
    userId: Mapped[int] = col("user_id", Integer, fk("users.id"), primary_key=True)
    companyId: Mapped[str] = col("company_id", ID, fk("companies.id"), primary_key=True)


class UserCostCenter(Base):
    """مراكز تكلفة في نطاق المستخدم (زيادة على الشركات) — مفيدة لمركز مالوش شركة مسجّلة."""
    __tablename__ = "user_cost_centers"
    userId: Mapped[int] = col("user_id", Integer, fk("users.id"), primary_key=True)
    costCenterId: Mapped[str] = col("cost_center_id", ID, fk("cost_centers.id"), primary_key=True)


class EmployeeAffiliation(Base):
    __tablename__ = "employee_affiliations"
    id: Mapped[int] = col("id", Integer, primary_key=True, autoincrement=True)
    employeeId: Mapped[str] = col("employee_id", ID, fk("employees.id"), nullable=False, index=True)
    position: Mapped[int] = col("position", Integer, nullable=False, default=0)       # 0 = الأساسي
    companyId: Mapped[Optional[str]] = col("company_id", ID, fk("companies.id"), index=True)
    projectId: Mapped[Optional[str]] = col("project_id", ID, fk("projects.id"), index=True)


class CompanyDoc(Base):
    __tablename__ = "company_docs"
    companyId: Mapped[str] = col("company_id", ID, fk("companies.id"), primary_key=True)
    kind: Mapped[str] = col("kind", String(40), primary_key=True)   # trafficAuth | civilAffairs | commercialLicense
    name: Mapped[Optional[str]] = col("name", Unicode(500))
    path: Mapped[Optional[str]] = col("path", Unicode(500))
    uploadedAt: Mapped[Optional[datetime]] = col("uploaded_at", DateTime)


class SignatoryDoc(Base):
    __tablename__ = "signatory_docs"
    civilId: Mapped[str] = col("civil_id", ID, primary_key=True)
    name: Mapped[Optional[str]] = col("name", Unicode(500))
    path: Mapped[Optional[str]] = col("path", Unicode(500))
    expiryDate: Mapped[Optional[date]] = col("expiry_date", Date)
    uploadedAt: Mapped[Optional[datetime]] = col("uploaded_at", DateTime)


class EmployeeFile(Base):
    __tablename__ = "employee_files"
    id: Mapped[str] = col("id", ID, primary_key=True)
    employeeId: Mapped[str] = col("employee_id", ID, nullable=False, index=True)
    name: Mapped[Optional[str]] = col("name", Unicode(500))
    path: Mapped[Optional[str]] = col("path", Unicode(500))
    size: Mapped[Optional[int]] = col("size", Integer)
    uploadedAt: Mapped[Optional[datetime]] = col("uploaded_at", DateTime)
    uploadedBy: Mapped[Optional[str]] = col("uploaded_by", NAME)


class Signature(Base):
    """صورة توقيع الشخص (مفوّض أو موظف) — مرة واحدة لكل رقم مدني، وبتتحط في العقود لو اتختارت."""
    __tablename__ = "signatures"
    civilId: Mapped[str] = col("civil_id", ID, primary_key=True)
    name: Mapped[Optional[str]] = col("name", NAME)            # اسم الملف الأصلي
    path: Mapped[str] = col("path", Unicode(500), nullable=False)
    uploadedAt: Mapped[Optional[datetime]] = col("uploaded_at", DateTime)
    uploadedBy: Mapped[Optional[str]] = col("uploaded_by", NAME)


class CompanyHistory(Base):
    __tablename__ = "company_history"
    id: Mapped[str] = col("id", ID, primary_key=True)
    companyId: Mapped[Optional[str]] = col("company_id", ID, index=True)
    type: Mapped[Optional[str]] = col("type", String(60))
    label: Mapped[Optional[str]] = col("label", TEXT)
    date: Mapped[Optional[datetime]] = col("date", DateTime, index=True)
    user: Mapped[Optional[str]] = col("user", NAME)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[str] = col("id", ID, primary_key=True)
    type: Mapped[Optional[str]] = col("type", String(60))
    category: Mapped[Optional[str]] = col("category", String(40), index=True)
    label: Mapped[Optional[str]] = col("label", TEXT)
    date: Mapped[Optional[datetime]] = col("date", DateTime, index=True)
    user: Mapped[Optional[str]] = col("user", NAME)


class EmployeeTimeline(Base):
    __tablename__ = "employee_timeline"
    id: Mapped[str] = col("id", ID, primary_key=True)
    employeeId: Mapped[Optional[str]] = col("employee_id", ID, index=True)
    type: Mapped[Optional[str]] = col("type", String(60))
    label: Mapped[Optional[str]] = col("label", TEXT)
    date: Mapped[Optional[datetime]] = col("date", DateTime)
    user: Mapped[Optional[str]] = col("user", NAME)


# ترتيب الجداول للنسخ/النقل (الأب قبل الابن)
ALL_MODELS = [Meta, Role, User, Company, UserCompany, Project, CostCenter, UserCostCenter, Signatory, Employee, EmployeeAffiliation,
              Vehicle, Candidate, CompanyDoc, SignatoryDoc, EmployeeFile, Signature, Template, CompanyHistory, AuditLog,
              EmployeeTimeline]
# جداول الحسابات والصلاحيات ← بتتعامل مع بعض في النسخ الاحتياطي (include_users)
AUTH_MODELS = (Role, User, UserCompany, UserCostCenter)


# ---------------------------------------------------------------------------
# العهد والمصروفات (custody.py)
# ---------------------------------------------------------------------------
class FeeItem(Base):
    """جدول رسوم المعاملات: بند لكل إجراء في كل نوع طلب (بيتعدّل من الشاشة)."""
    __tablename__ = "fee_items"
    id: Mapped[str] = col("id", ID, primary_key=True)
    txType: Mapped[str] = col("tx_type", String(30), nullable=False, index=True)   # custody.TX_TYPES
    position: Mapped[int] = col("position", Integer, nullable=False, default=0)
    name: Mapped[str] = col("name", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)                          # للكشوف (ثنائية اللغة)
    authority: Mapped[Optional[str]] = col("authority", NAME)                     # الجهة
    amount: Mapped[Optional[float]] = col("amount", Float)                        # فاضي = مبلغ مفتوح لكل شخص
    options: Mapped[Optional[str]] = col("options", SHORT)                        # «60,260,360,460»
    stage: Mapped[Optional[str]] = col("stage", String(60))                       # المرحلة اللي بتعلّم البند «تم»
    active: Mapped[bool] = col("active", Boolean, nullable=False, default=True)


class Custody(Base):
    __tablename__ = "custodies"
    id: Mapped[str] = col("id", ID, primary_key=True)
    no: Mapped[int] = col("no", Integer, nullable=False, unique=True)              # رقم العهدة للعرض والطباعة
    txType: Mapped[str] = col("tx_type", String(30), nullable=False)
    custodian: Mapped[str] = col("custodian", NAME, nullable=False)               # المستلم (أي اسم)
    companyId: Mapped[Optional[str]] = col("company_id", ID, fk("companies.id"))  # رأس الطباعة (اختياري)
    status: Mapped[str] = col("status", String(20), nullable=False, default="requested")   # requested | disbursed | closed | cancelled
    requestDate: Mapped[Optional[date]] = col("request_date", Date)
    requestedAmount: Mapped[Optional[float]] = col("requested_amount", Float)
    disbursedAmount: Mapped[Optional[float]] = col("disbursed_amount", Float)
    disbursedDate: Mapped[Optional[date]] = col("disbursed_date", Date)
    closedDate: Mapped[Optional[date]] = col("closed_date", Date)
    adminFee: Mapped[Optional[float]] = col("admin_fee", Float)                   # الدعم الإداري لكل شخص في كشف التقفيل
    notes: Mapped[Optional[str]] = col("notes", TEXT)
    createdBy: Mapped[Optional[str]] = col("created_by", NAME)
    createdAt: Mapped[Optional[datetime]] = col("created_at", DateTime)


class CustodyLine(Base):
    """بند في العهدة لشخص: نسخة من الاسم ومركز التكلفة والشركة والبند وقت الطلب."""
    __tablename__ = "custody_lines"
    id: Mapped[int] = col("id", Integer, primary_key=True, autoincrement=True)
    custodyId: Mapped[str] = col("custody_id", ID, fk("custodies.id"), nullable=False, index=True)
    personKind: Mapped[str] = col("person_kind", String(20), nullable=False)       # employee | candidate
    personId: Mapped[str] = col("person_id", ID, nullable=False, index=True)       # الرقم المدني أو رقم المترشّح
    personName: Mapped[Optional[str]] = col("person_name", NAME)
    civilId: Mapped[Optional[str]] = col("civil_id", ID)
    costCenter: Mapped[Optional[str]] = col("cost_center", NAME)
    companyId: Mapped[Optional[str]] = col("company_id", ID)
    feeItemId: Mapped[Optional[str]] = col("fee_item_id", ID)
    itemName: Mapped[Optional[str]] = col("item_name", NAME)
    itemNameEn: Mapped[Optional[str]] = col("item_name_en", NAME)
    authority: Mapped[Optional[str]] = col("authority", NAME)
    stage: Mapped[Optional[str]] = col("stage", String(60))
    position: Mapped[int] = col("position", Integer, nullable=False, default=0)
    planned: Mapped[Optional[float]] = col("planned", Float)                      # المبلغ المحدد وقت الطلب
    actual: Mapped[Optional[float]] = col("actual", Float)                        # المصروف فعلًا
    done: Mapped[bool] = col("done", Boolean, nullable=False, default=False)
    doneDate: Mapped[Optional[date]] = col("done_date", Date)
    receiptNo: Mapped[Optional[str]] = col("receipt_no", SHORT)
    closedDate: Mapped[Optional[date]] = col("closed_date", Date)                 # اتقفل في كشف التقفيل بتاريخ ده


class Invoice(Base):
    """فاتورة من الشركة المُصدِرة لمركز تكلفة في تقفيل عهدة: الرسوم الحكومية + الدعم الإداري لكل موظف.
    INV-<السنة>-<مسلسل يبدأ من 1 كل سنة>. pending ← التقفيل بيتلغي وهي بتتمسح، approved (اعتمدتها الحسابات) ← نهائية."""
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("year", "no"),)
    id: Mapped[str] = col("id", ID, primary_key=True)
    year: Mapped[int] = col("year", Integer, nullable=False)
    no: Mapped[int] = col("no", Integer, nullable=False)
    custodyId: Mapped[str] = col("custody_id", ID, fk("custodies.id"), nullable=False, index=True)
    closingDate: Mapped[date] = col("closing_date", Date, nullable=False)          # تاريخ التقفيل اللي طلعت منه
    costCenter: Mapped[Optional[str]] = col("cost_center", NAME)                   # فاتورة إلى
    billCompanyId: Mapped[Optional[str]] = col("bill_company_id", ID)              # شركة مركز التكلفة
    issuerCompanyId: Mapped[Optional[str]] = col("issuer_company_id", ID)          # المُصدِر (أبراج انرجي)
    employees: Mapped[int] = col("employees", Integer, nullable=False, default=0)
    govAmount: Mapped[float] = col("gov_amount", Float, nullable=False, default=0)
    supportFee: Mapped[float] = col("support_fee", Float, nullable=False, default=0)          # لكل موظف
    supportAmount: Mapped[float] = col("support_amount", Float, nullable=False, default=0)
    total: Mapped[float] = col("total", Float, nullable=False, default=0)
    status: Mapped[str] = col("status", String(20), nullable=False, default="pending")       # pending | approved
    approvedDate: Mapped[Optional[date]] = col("approved_date", Date)
    approvedBy: Mapped[Optional[str]] = col("approved_by", NAME)
    createdBy: Mapped[Optional[str]] = col("created_by", NAME)
    createdAt: Mapped[Optional[datetime]] = col("created_at", DateTime)
