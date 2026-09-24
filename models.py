# -*- coding: utf-8 -*-
"""
Lunx — نماذج قاعدة البيانات (SQLAlchemy 2.x ORM)

- أسماء الخصائص في بايثون = أسماء الحقول في الـ API (camelCase).
- أسماء الأعمدة في قاعدة البيانات snake_case (زي ما هي من الأول، فالنسخ القديمة متوافقة).
- الأنواع محايدة: String/Text/Date/DateTime/Boolean/Float/Integer
  ← تشتغل على SQLite و PostgreSQL و MySQL/MariaDB و SQL Server من غير تعديل.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


ID = String(64)          # معرّفات نصية (c1, cand_xxx, الرقم المدني …)
NAME = String(300)
SHORT = String(120)


def col(name, type_, **kw):
    return mapped_column(name, type_, **kw)


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
    trafficAuthExpiry: Mapped[Optional[date]] = col("traffic_auth_expiry", Date)
    civilAffairsAuthExpiry: Mapped[Optional[date]] = col("civil_affairs_auth_expiry", Date)
    activity: Mapped[Optional[str]] = col("activity", NAME)
    logoPath: Mapped[Optional[str]] = col("logo_path", String(500))


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = col("id", ID, primary_key=True)
    companyId: Mapped[Optional[str]] = col("company_id", ID, index=True)
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


class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[str] = col("id", ID, primary_key=True)
    plate: Mapped[str] = col("plate", SHORT, nullable=False, unique=True)
    model: Mapped[Optional[str]] = col("model", NAME)
    companyId: Mapped[Optional[str]] = col("company_id", ID)
    driverId: Mapped[Optional[str]] = col("driver_id", ID)
    insuranceExpiry: Mapped[Optional[date]] = col("insurance_expiry", Date)
    govLicenseExpiry: Mapped[Optional[date]] = col("gov_license_expiry", Date)
    notes: Mapped[Optional[str]] = col("notes", Text)


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
    dateOfHire: Mapped[Optional[date]] = col("date_of_hire", Date)
    salary: Mapped[Optional[float]] = col("salary", Float)
    housingIncluded: Mapped[bool] = col("housing_included", Boolean, default=False)
    housingAmount: Mapped[Optional[float]] = col("housing_amount", Float)
    employmentStatus: Mapped[Optional[str]] = col("employment_status", String(40), default="active")
    contractType: Mapped[Optional[str]] = col("contract_type", SHORT)
    residencyExp: Mapped[Optional[date]] = col("residency_exp", Date)
    workPermitExp: Mapped[Optional[date]] = col("work_permit_exp", Date)
    workPermitIssue: Mapped[Optional[date]] = col("work_permit_issue", Date)
    passportNo: Mapped[Optional[str]] = col("passport_no", SHORT, index=True)
    passportExp: Mapped[Optional[date]] = col("passport_exp", Date)
    healthCardExp: Mapped[Optional[date]] = col("health_card_exp", Date)
    isDriver: Mapped[bool] = col("is_driver", Boolean, default=False)
    drivingLicenseExp: Mapped[Optional[date]] = col("driving_license_exp", Date)
    costCenter: Mapped[Optional[str]] = col("cost_center", NAME)
    actualWorkplace: Mapped[Optional[str]] = col("actual_workplace", NAME)
    fileNo: Mapped[Optional[str]] = col("file_no", SHORT)
    govStage: Mapped[Optional[str]] = col("gov_stage", String(60))
    govStageNote: Mapped[Optional[str]] = col("gov_stage_note", Text)
    govStageResponsible: Mapped[Optional[str]] = col("gov_stage_responsible", NAME)
    govStageStartDate: Mapped[Optional[date]] = col("gov_stage_start_date", Date)
    govTransactionCost: Mapped[Optional[float]] = col("gov_transaction_cost", Float)
    transferNote: Mapped[Optional[str]] = col("transfer_note", Text)
    bank: Mapped[Optional[str]] = col("bank", NAME)
    iban: Mapped[Optional[str]] = col("iban", SHORT)
    dpId: Mapped[Optional[str]] = col("dp_id", SHORT)
    phone: Mapped[Optional[str]] = col("phone", SHORT)
    notes: Mapped[Optional[str]] = col("notes", Text)
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
    salary: Mapped[Optional[float]] = col("salary", Float)
    housingAllowance: Mapped[bool] = col("housing_allowance", Boolean, default=False)
    source: Mapped[Optional[str]] = col("source", String(20), default="outside")
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
    targetCompanyId: Mapped[Optional[str]] = col("target_company_id", ID)
    costCenter: Mapped[Optional[str]] = col("cost_center", NAME)
    notes: Mapped[Optional[str]] = col("notes", Text)


class Signatory(Base):
    __tablename__ = "signatories"
    id: Mapped[str] = col("id", ID, primary_key=True)
    companyId: Mapped[str] = col("company_id", ID, nullable=False, index=True)
    nameAr: Mapped[str] = col("name_ar", NAME, nullable=False)
    nameEn: Mapped[Optional[str]] = col("name_en", NAME)
    civilId: Mapped[Optional[str]] = col("civil_id", ID)


class Template(Base):
    __tablename__ = "templates"
    id: Mapped[str] = col("id", ID, primary_key=True)
    name: Mapped[str] = col("name", NAME, nullable=False)
    filename: Mapped[str] = col("filename", String(500), nullable=False)
    isDefault: Mapped[bool] = col("is_default", Boolean, default=False)
    createdAt: Mapped[Optional[datetime]] = col("created_at", DateTime)


# ---------------------------------------------------------------------------
# الجداول المساعدة
# ---------------------------------------------------------------------------
class Meta(Base):
    __tablename__ = "meta"
    key: Mapped[str] = col("key", String(100), primary_key=True)
    value: Mapped[Optional[str]] = col("value", Text)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = col("id", Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = col("username", SHORT, nullable=False, unique=True)
    displayName: Mapped[Optional[str]] = col("display_name", NAME)
    passwordHash: Mapped[str] = col("password_hash", String(300), nullable=False)
    role: Mapped[str] = col("role", String(20), nullable=False, default="editor")   # admin | editor | viewer


class EmployeeAffiliation(Base):
    __tablename__ = "employee_affiliations"
    id: Mapped[int] = col("id", Integer, primary_key=True, autoincrement=True)
    employeeId: Mapped[str] = col("employee_id", ID, nullable=False, index=True)
    position: Mapped[int] = col("position", Integer, nullable=False, default=0)       # 0 = الأساسي
    companyId: Mapped[Optional[str]] = col("company_id", ID, index=True)
    projectId: Mapped[Optional[str]] = col("project_id", ID, index=True)


class CompanyDoc(Base):
    __tablename__ = "company_docs"
    companyId: Mapped[str] = col("company_id", ID, primary_key=True)
    kind: Mapped[str] = col("kind", String(40), primary_key=True)   # trafficAuth | civilAffairs | commercialLicense
    name: Mapped[Optional[str]] = col("name", String(500))
    path: Mapped[Optional[str]] = col("path", String(500))
    uploadedAt: Mapped[Optional[datetime]] = col("uploaded_at", DateTime)


class SignatoryDoc(Base):
    __tablename__ = "signatory_docs"
    civilId: Mapped[str] = col("civil_id", ID, primary_key=True)
    name: Mapped[Optional[str]] = col("name", String(500))
    path: Mapped[Optional[str]] = col("path", String(500))
    expiryDate: Mapped[Optional[date]] = col("expiry_date", Date)
    uploadedAt: Mapped[Optional[datetime]] = col("uploaded_at", DateTime)


class EmployeeFile(Base):
    __tablename__ = "employee_files"
    id: Mapped[str] = col("id", ID, primary_key=True)
    employeeId: Mapped[str] = col("employee_id", ID, nullable=False, index=True)
    name: Mapped[Optional[str]] = col("name", String(500))
    path: Mapped[Optional[str]] = col("path", String(500))
    size: Mapped[Optional[int]] = col("size", Integer)
    uploadedAt: Mapped[Optional[datetime]] = col("uploaded_at", DateTime)
    uploadedBy: Mapped[Optional[str]] = col("uploaded_by", NAME)


class CompanyHistory(Base):
    __tablename__ = "company_history"
    id: Mapped[str] = col("id", ID, primary_key=True)
    companyId: Mapped[Optional[str]] = col("company_id", ID, index=True)
    type: Mapped[Optional[str]] = col("type", String(60))
    label: Mapped[Optional[str]] = col("label", Text)
    date: Mapped[Optional[datetime]] = col("date", DateTime, index=True)
    user: Mapped[Optional[str]] = col("user", NAME)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[str] = col("id", ID, primary_key=True)
    type: Mapped[Optional[str]] = col("type", String(60))
    category: Mapped[Optional[str]] = col("category", String(40), index=True)
    label: Mapped[Optional[str]] = col("label", Text)
    date: Mapped[Optional[datetime]] = col("date", DateTime, index=True)
    user: Mapped[Optional[str]] = col("user", NAME)


class EmployeeTimeline(Base):
    __tablename__ = "employee_timeline"
    id: Mapped[str] = col("id", ID, primary_key=True)
    employeeId: Mapped[Optional[str]] = col("employee_id", ID, index=True)
    type: Mapped[Optional[str]] = col("type", String(60))
    label: Mapped[Optional[str]] = col("label", Text)
    date: Mapped[Optional[datetime]] = col("date", DateTime)
    user: Mapped[Optional[str]] = col("user", NAME)


# ترتيب الجداول للنسخ/النقل (الأب قبل الابن)
ALL_MODELS = [Meta, User, Company, Project, CostCenter, Signatory, Employee, EmployeeAffiliation, Vehicle,
              Candidate, CompanyDoc, SignatoryDoc, EmployeeFile, Template, CompanyHistory, AuditLog,
              EmployeeTimeline]
