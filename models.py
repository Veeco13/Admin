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
    fileNumber: Mapped[Optional[str]] = col("file_number", SHORT, index=True)      # الرقم المدني للترخيص
    laborOffice: Mapped[Optional[str]] = col("labor_office", NAME)
    expiryDate: Mapped[Optional[date]] = col("expiry_date", Date)                   # نهاية الترخيص
    kind: Mapped[Optional[str]] = col("kind", String(20))                           # main ترخيص رئيسي | gov عقد حكومي | sub عقد من الباطن
    contractNo: Mapped[Optional[str]] = col("contract_no", SHORT)                   # رقم العقد الحكومي
    agencyId: Mapped[Optional[str]] = col("agency_id", ID, fk("agencies.id"))       # الوكالة اللي العقد تابع لها
    startDate: Mapped[Optional[date]] = col("start_date", Date)                     # بداية الترخيص


class CostCenter(Base):
    __tablename__ = "cost_centers"
    id: Mapped[str] = col("id", ID, primary_key=True)
    name: Mapped[str] = col("name", NAME, nullable=False, unique=True)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    code: Mapped[Optional[str]] = col("code", String(10), unique=True)          # رمزه في أرقام الفواتير (SUP) — بيتقفل أول ما يتستخدم
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
    projectId: Mapped[Optional[str]] = col("project_id", ID, fk("projects.id"))     # العقد / المشروع المسجّلة عليه
    costCenter: Mapped[Optional[str]] = col("cost_center", NAME)                    # مكان الشغل الفعلي (بالاسم زي الموظف)
    vehicleType: Mapped[Optional[str]] = col("vehicle_type", String(20))            # نوع المركبة (تصنيف الهيئة)
    # المالك الفعلي لو غير الشركة المسجّلة باسمها (فاضي = نفسها)
    ownerCompanyId: Mapped[Optional[str]] = col("owner_company_id", ID, fk("companies.id"))
    # ملف الشؤون المسجّلة عليه (علشان العمالة) — غير العقد اللي فوق (اللي بيأثر على التصاريح)
    affairsProjectId: Mapped[Optional[str]] = col("affairs_project_id", ID, fk("projects.id"))
    # مع مين / المستخدم: الموظف في driverId (أي موظف)، أو اسم حر هنا لو اللي معاه العربية مش موظف متسجّل
    userName: Mapped[Optional[str]] = col("user_name", NAME)


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
    kuwaitEntryDate: Mapped[Optional[date]] = col("kuwait_entry_date", Date)     # تاريخ دخول الكويت
    university: Mapped[Optional[str]] = col("university", NAME)                  # الجامعة / جهة التخرج (للمؤهل)
    serviceEndDate: Mapped[Optional[date]] = col("service_end_date", Date)      # آخر يوم عمل (إقرار المخالصة)
    serviceEndType: Mapped[Optional[str]] = col("service_end_type", String(20))   # resigned | terminated (بعد فترة الإنذار)
    serviceEndReason: Mapped[Optional[str]] = col("service_end_reason", NAME)     # سبب انتهاء الخدمة
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
    # المشروع / العقد المستهدف (تبع الشركة المستهدفة): إدارة العمل ورقم الملف في عقد العمل، ومشروعه لما يتحوّل لموظف
    targetProjectId: Mapped[Optional[str]] = col("target_project_id", ID, fk("projects.id"))
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
    custodyCode: Mapped[Optional[str]] = col("custody_code", String(10))          # رمزه في أرقام العهد (AA-0001)
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
    # البند بيجدد تاريخ في بيانات الموظف (residencyExp | workPermitExp | healthCardExp) ← الانتهاء الجديد بيتسجّل عليه
    updatesField: Mapped[Optional[str]] = col("updates_field", String(30))


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
    ownerId: Mapped[Optional[int]] = col("owner_id", Integer)                     # صاحب العهدة (بيشوفها هو بس)
    prefix: Mapped[Optional[str]] = col("prefix", String(10))                     # رمز صاحبها وقت الطلب
    seq: Mapped[Optional[int]] = col("seq", Integer)                              # مسلسل لكل رمز ← «AA-0001»


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
    dupOk: Mapped[bool] = col("dup_ok", Boolean, nullable=False, default=False)   # اتطلب تاني خلال 90 يوم بتأكيد
    # بند التجديد: التاريخ اللي بيجدده (نسخة من البند وقت الطلب)، وقيمته وقت الطلب، والانتهاء الجديد اللي اتسجّل
    updatesField: Mapped[Optional[str]] = col("updates_field", String(30))
    oldExpiry: Mapped[Optional[date]] = col("old_expiry", Date)
    newExpiry: Mapped[Optional[date]] = col("new_expiry", Date)


class Invoice(Base):
    """فاتورة من الشركة المُصدِرة لمركز تكلفة في تقفيل عهدة: الرسوم الحكومية + الدعم الإداري لكل موظف.
    INV-<السنة>-<مسلسل يبدأ من 1 كل سنة>. pending ← التقفيل بيتلغي وهي بتتمسح، approved (اعتمدتها الحسابات) ← نهائية."""
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("cc_code", "year", "no"),)
    id: Mapped[str] = col("id", ID, primary_key=True)
    year: Mapped[int] = col("year", Integer, nullable=False)
    no: Mapped[int] = col("no", Integer, nullable=False)                         # مسلسل لكل رمز مركز في السنة
    ccCode: Mapped[Optional[str]] = col("cc_code", String(10))                   # رمز المركز وقت التقفيل ← INV-SUP-2026-0001
    closingSeq: Mapped[Optional[int]] = col("closing_seq", Integer)              # مسلسل التقفيل في العهدة
    closingRef: Mapped[Optional[str]] = col("closing_ref", String(30))            # رقم التقفيل «AA-0001/1» (بيتثبّت)
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


# ---------------------------------------------------------------------------
# الوكالات (الشركة وكيلة لشركات تانية والعقود الحكومية تابعة للوكالات)
# ---------------------------------------------------------------------------
class Agency(Base):
    """وكالة للشركة (أبراج انرجي وكيلة لـ Superior و Scomi): العقود الحكومية بتتبعها، ومراكز التكلفة التابعة لها
    بتحدد مين «برّه وكالة عقده» (للتقارير بس)."""
    __tablename__ = "agencies"
    id: Mapped[str] = col("id", ID, primary_key=True)
    companyId: Mapped[Optional[str]] = col("company_id", ID, fk("companies.id"), index=True)
    nameAr: Mapped[str] = col("name_ar", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    position: Mapped[int] = col("position", Integer, nullable=False, default=0)


class AgencyCostCenter(Base):
    __tablename__ = "agency_cost_centers"
    agencyId: Mapped[str] = col("agency_id", ID, fk("agencies.id"), primary_key=True)
    costCenterId: Mapped[str] = col("cost_center_id", ID, fk("cost_centers.id"), primary_key=True)


# ---------------------------------------------------------------------------
# التصاريح (للموظفين والسيارات) — الأنواع والأماكن قايمتين بيتحكم فيهم مدير النظام
# ---------------------------------------------------------------------------
class PermitType(Base):
    __tablename__ = "permit_types"
    id: Mapped[str] = col("id", ID, primary_key=True)
    nameAr: Mapped[str] = col("name_ar", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    appliesTo: Mapped[Optional[str]] = col("applies_to", String(10))           # employee | vehicle | فاضي = الاتنين
    position: Mapped[int] = col("position", Integer, nullable=False, default=0)
    defaultIssuer: Mapped[Optional[str]] = col("default_issuer", NAME)          # الجهة المانحة اللي بتتملى لوحدها
    # تصريح بيعتمد على تصريح تاني (الرتقة والعبدلي ← KOC): مايطلعش غير لو صاحبه معاه تصريح ساري من النوع ده،
    # و sameExpiry ← بينتهي مع تاريخه وعلى نفس عقده. من غير FK (مرجع لنفس الجدول — الترتيب في الاستعادة مايفرقش)
    requiresTypeId: Mapped[Optional[str]] = col("requires_type_id", ID)
    sameExpiry: Mapped[Optional[bool]] = col("same_expiry", Boolean)
    renewWindowDays: Mapped[Optional[int]] = col("renew_window_days", Integer)       # بيتجدد في آخر كام يوم قبل انتهاؤه (30)


class PermitPlace(Base):
    __tablename__ = "permit_places"
    id: Mapped[str] = col("id", ID, primary_key=True)
    nameAr: Mapped[str] = col("name_ar", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    position: Mapped[int] = col("position", Integer, nullable=False, default=0)


class Permit(Base):
    """تصريح لموظف أو لعربية: النوع والرقم والجهة المانحة والأماكن، وطالع على عقد (حكومي أو من الباطن — الافتراضي
    عقد صاحبه) وهو اللي بيحد تاريخه مع الإقامة / التأمين / الدفتر."""
    __tablename__ = "permits"
    id: Mapped[str] = col("id", ID, primary_key=True)
    holderKind: Mapped[str] = col("holder_kind", String(10), nullable=False)    # employee | vehicle
    employeeId: Mapped[Optional[str]] = col("employee_id", ID, fk("employees.id"), index=True)
    vehicleId: Mapped[Optional[str]] = col("vehicle_id", ID, fk("vehicles.id"), index=True)
    typeId: Mapped[str] = col("type_id", ID, fk("permit_types.id"), nullable=False)
    # التصريح الأساسي اللي ده معتمد عليه (الرتقة ← الـ KOC بتاعه) — من غير FK زي requiresTypeId
    parentId: Mapped[Optional[str]] = col("parent_id", ID, index=True)
    permitNo: Mapped[Optional[str]] = col("permit_no", SHORT)
    issuer: Mapped[Optional[str]] = col("issuer", NAME)                          # الجهة المانحة
    projectId: Mapped[Optional[str]] = col("project_id", ID, fk("projects.id"))
    issueDate: Mapped[Optional[date]] = col("issue_date", Date)
    expiryDate: Mapped[Optional[date]] = col("expiry_date", Date)
    notes: Mapped[Optional[str]] = col("notes", TEXT)
    filePath: Mapped[Optional[str]] = col("file_path", Unicode(500))             # المرفق (للعرض بس)
    fileName: Mapped[Optional[str]] = col("file_name", Unicode(500))
    createdAt: Mapped[Optional[datetime]] = col("created_at", DateTime)
    createdBy: Mapped[Optional[str]] = col("created_by", NAME)
    updatedAt: Mapped[Optional[datetime]] = col("updated_at", DateTime)
    updatedBy: Mapped[Optional[str]] = col("updated_by", NAME)


class PermitLog(Base):
    """سجل التصاريح لكل صاحب تصريح (موظف أو عربية): إضافة، تعديل، حذف، مرفق، طباعة، نموذج — زي سجل الموظف."""
    __tablename__ = "permit_log"
    id: Mapped[int] = col("id", Integer, primary_key=True, autoincrement=True)
    holderKind: Mapped[str] = col("holder_kind", String(10), nullable=False)     # employee | vehicle
    holderId: Mapped[str] = col("holder_id", ID, nullable=False, index=True)     # الرقم المدني أو رقم العربية
    permitId: Mapped[Optional[str]] = col("permit_id", ID)                       # من غير FK (التصريح ممكن يتمسح)
    action: Mapped[str] = col("action", String(20), nullable=False)              # add | edit | delete | file | print | form
    label: Mapped[Optional[str]] = col("label", TEXT)
    date: Mapped[Optional[datetime]] = col("date", DateTime)
    user: Mapped[Optional[str]] = col("user", NAME)


class PermitPlaceLink(Base):
    __tablename__ = "permit_place_links"
    permitId: Mapped[str] = col("permit_id", ID, fk("permits.id"), primary_key=True)
    placeId: Mapped[str] = col("place_id", ID, fk("permit_places.id"), primary_key=True)


# ---------------------------------------------------------------------------
# الخطابات والشهادات (letters.py): شهادة راتب / استمرارية راتب / طلب إجازة — رقم لكل خطاب ونسخة من بياناته
# ---------------------------------------------------------------------------
class HrLetter(Base):
    __tablename__ = "hr_letters"
    __table_args__ = (UniqueConstraint("series", "year", "no"),)
    id: Mapped[str] = col("id", ID, primary_key=True)
    kind: Mapped[str] = col("kind", String(20), nullable=False)                 # salary | continuity | leave | return
    series: Mapped[str] = col("series", String(10), nullable=False)             # SCR (الشهادات) | LV (الإجازة) | RT (العودة)
    year: Mapped[int] = col("year", Integer, nullable=False)
    no: Mapped[int] = col("no", Integer, nullable=False)
    number: Mapped[str] = col("number", SHORT, nullable=False, unique=True)     # HR-SCR-2026-0001 / LV-2026-0001
    employeeId: Mapped[Optional[str]] = col("employee_id", ID, fk("employees.id"), index=True)
    companyId: Mapped[Optional[str]] = col("company_id", ID, fk("companies.id"))
    data: Mapped[Optional[str]] = col("data", TEXT)                             # نسخة البيانات وقت الإصدار (JSON)
    status: Mapped[Optional[str]] = col("status", String(20))                   # الإجازة: submitted | approved | rejected
    dateFrom: Mapped[Optional[date]] = col("date_from", Date)
    dateTo: Mapped[Optional[date]] = col("date_to", Date)
    days: Mapped[Optional[int]] = col("days", Integer)
    createdBy: Mapped[Optional[str]] = col("created_by", NAME)
    createdAt: Mapped[Optional[datetime]] = col("created_at", DateTime)
    decidedBy: Mapped[Optional[str]] = col("decided_by", NAME)
    decidedAt: Mapped[Optional[datetime]] = col("decided_at", DateTime)


# ---------------------------------------------------------------------------
# الاستيراد التكميلي (import_extra.py): كل دفعة وكل قيمة اتغيّرت فيها ← التراجع
# ---------------------------------------------------------------------------
class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[str] = col("id", ID, primary_key=True)
    target: Mapped[str] = col("target", String(20), nullable=False)             # employees | vehicles
    fileName: Mapped[Optional[str]] = col("file_name", NAME)
    sheet: Mapped[Optional[str]] = col("sheet", SHORT)
    summary: Mapped[Optional[str]] = col("summary", TEXT)                       # JSON: الأعداد (اتملى، اتضاف، مختلف، …)
    createdBy: Mapped[Optional[str]] = col("created_by", NAME)
    createdAt: Mapped[Optional[datetime]] = col("created_at", DateTime)
    undoneBy: Mapped[Optional[str]] = col("undone_by", NAME)
    undoneAt: Mapped[Optional[datetime]] = col("undone_at", DateTime)


class ImportChange(Base):
    __tablename__ = "import_changes"
    id: Mapped[int] = col("id", Integer, primary_key=True, autoincrement=True)
    batchId: Mapped[str] = col("batch_id", ID, fk("import_batches.id"), nullable=False, index=True)
    entity: Mapped[str] = col("entity", String(20), nullable=False)             # employee | vehicle
    recordId: Mapped[str] = col("record_id", ID, nullable=False)
    field: Mapped[str] = col("field", String(60), nullable=False)               # «__created» = السجل نفسه اتضاف
    oldValue: Mapped[Optional[str]] = col("old_value", TEXT)
    newValue: Mapped[Optional[str]] = col("new_value", TEXT)


# ---------------------------------------------------------------------------
# 🗑️ سلة المحذوفات (trash.py): نسخة كاملة من المحذوف والمرتبط بيه ← الاسترجاع (90 يوم)
# ---------------------------------------------------------------------------
class Trash(Base):
    __tablename__ = "trash"
    id: Mapped[str] = col("id", ID, primary_key=True)
    kind: Mapped[str] = col("kind", String(20), nullable=False)                 # employee | candidate | vehicle | permit
    recordId: Mapped[str] = col("record_id", ID, nullable=False)
    label: Mapped[Optional[str]] = col("label", NAME)
    companyIds: Mapped[Optional[str]] = col("company_ids", TEXT)                # JSON ← نطاق الشركات لمين يشوفه
    data: Mapped[Optional[str]] = col("data", TEXT)                             # JSON: {rows, relink, files, summary}
    deletedBy: Mapped[Optional[str]] = col("deleted_by", NAME)
    deletedAt: Mapped[Optional[datetime]] = col("deleted_at", DateTime, index=True)


# ---------------------------------------------------------------------------
# ✋ الموافقة على التعديلات الحساسة (approvals.py)
# ---------------------------------------------------------------------------
class ApprovalRequest(Base):
    __tablename__ = "approval_requests"
    id: Mapped[str] = col("id", ID, primary_key=True)
    employeeId: Mapped[str] = col("employee_id", ID, nullable=False, index=True)   # مش FK: طلب الحذف بيفضل بعد الحذف
    employeeName: Mapped[Optional[str]] = col("employee_name", NAME)
    kind: Mapped[str] = col("kind", String(20), nullable=False)                 # salary | bank | service_end | delete
    changes: Mapped[Optional[str]] = col("changes", TEXT)                       # JSON {الخانة: [القديم، الجديد]}
    note: Mapped[Optional[str]] = col("note", TEXT)                             # ملاحظة / سبب من صاحب الطلب
    source: Mapped[Optional[str]] = col("source", NAME)                         # منين (بطاقة الموظف، الاستيراد، استمارة 103…)
    status: Mapped[str] = col("status", String(20), nullable=False, index=True)  # pending | approved | rejected | cancelled
    requestedBy: Mapped[Optional[str]] = col("requested_by", NAME)
    requestedById: Mapped[Optional[str]] = col("requested_by_id", ID)
    requestedAt: Mapped[Optional[datetime]] = col("requested_at", DateTime)
    decidedBy: Mapped[Optional[str]] = col("decided_by", NAME)
    decidedAt: Mapped[Optional[datetime]] = col("decided_at", DateTime)
    decisionNote: Mapped[Optional[str]] = col("decision_note", TEXT)


# النسخ الاحتياطي: العهد والفواتير والوكالات والتصاريح والخطابات ودفعات الاستيراد والسلة والطلبات كمان
ALL_MODELS.extend([FeeItem, Custody, CustodyLine, Invoice, Agency, AgencyCostCenter, PermitType, PermitPlace, Permit, PermitPlaceLink, PermitLog,
                   HrLetter, ImportBatch, ImportChange, Trash, ApprovalRequest])
