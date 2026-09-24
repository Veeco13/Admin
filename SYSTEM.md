# Lunx: هيكل النظام (نسخة Flask)

**شركة أبراج انرجي ومجموعة شركاتها التابعة**
الإصدار: **v353-flask.3** · مبني على مواصفات Lunx v353 · تاريخ التوثيق: 2026-09-24

دي نفس وثيقة Lunx بعد ما اتظبطت على مشروع **zahed**. الشاشات والكيانات وقواعد العمل زي ما هي، والمعمارية بقت سيرفر Flask مع SQLAlchemy بدل ملف HTML واحد، وتقدر تشغّلها على SQLite أو PostgreSQL أو MySQL أو SQL Server.

---

## 1. التشغيل

```bash
pip install -r requirements.txt
python seed_import.py      # أول مرة بس: بيستورد data/manp.xlsx + data/legacy_database.db
python app.py              # http://localhost:5050
```
أو على ويندوز: دبل كليك على `run_windows.bat`.

**أول دخول:** `admin` / `admin123`. غيّر الباسورد من قائمة المستخدم (👤).

**PDF:** محتاج LibreOffice على الجهاز (أو MS Word على ويندوز). ملف Word بيشتغل من غيره.

---

## 2. المعمارية

```
zahed/
├─ app.py              ← Flask: المصادقة + كل الـ API + تنزيل العقود
├─ models.py           ← نماذج SQLAlchemy (كل الجداول والأنواع)
├─ db.py               ← الاتصال (LUNX_DATABASE_URL) + الترقية التلقائية + السجلات + dump_state() + النسخ
├─ db_transfer.py      ← نقل البيانات بين أي نوعين من قواعد البيانات
├─ manage_db.py        ← أداة إدارة القاعدة (info/check/upgrade/revision/backup/restore/transfer)
├─ alembic.ini + migrations/  ← تعديلات الهيكل (Alembic)
├─ backups/            ← نسخ JSON تلقائية يومية
├─ Dockerfile · docker-compose*.yml · docker-entrypoint.sh · .env.example  ← التشغيل في Docker
├─ docx_engine.py      ← محرك العقود ⚠️ مُجمَّد
├─ importer.py         ← استيراد Excel/CSV (بعناوين أو ملف القوى العاملة من غير عناوين)
├─ seed_import.py      ← الاستيراد الأولي من النظام القديم
├─ lunx.db             ← قاعدة البيانات الافتراضية (SQLite)
├─ templates/          ← index.html (هيكل الـ SPA) + login.html
├─ static/
│  ├─ app.css          ← متغيرات الألوان، الوضع الداكن/الفاتح، RTL، الطباعة
│  ├─ i18n.js          ← قاموس I18N (عربي ← إنجليزي)
│  └─ js/ core · dashboard · employees · org · contract · recruit
├─ templates_docs/     ← قوالب Word
├─ uploads/            ← المرفقات، مستندات الشركات، بطاقات المفوّضين، الشعارات
└─ data/               ← ملفات البيانات القديمة (للاستيراد الأولي)
```

### تدفق التشغيل

```
تحميل الصفحة → GET /api/state → STATE → render(VIEW)
المستخدم يعدّل → persist(method, url, body) → API → SQLAlchemy (قاعدة البيانات) + سجل التدقيق → reload() → render
```

### مقارنة بنسخة الملف الواحد

| في Lunx v353 | في النسخة دي |
|---|---|
| `seed-data` جوه ملف الـ HTML | قاعدة بيانات عبر SQLAlchemy (الافتراضي `lunx.db` SQLite) |
| `persist()` بتعيد نشر الصفحة كلها | `persist()` بتنادي API وبعدين `reload()` |
| `CAP.user` + وضع القراءة فقط | تسجيل دخول بصلاحيات: `admin` / `editor` / `viewer` (المشاهد = قراءة فقط، والسيرفر بيرفض أي تعديل منه بـ 403) |
| `CAP.mcp` → Google Drive | المرفقات بتتخزن في `uploads/employees/<الرقم المدني>/` |
| `CAP.downloads` | تنزيل مباشر من السيرفر (Word / PDF / JSON)، وCSV بيتعمل في المتصفح |
| JSZip في المتصفح | `python-docx` على السيرفر |
| بروتوكول الدمج قبل النشر | مش محتاجينه: التعديلات بتروح لقاعدة البيانات على طول، وعدة مستخدمين بيشتغلوا في نفس الوقت |

---

## 3. التقنيات

| الطبقة | التقنية |
|---|---|
| السيرفر | Python 3.10+ و Flask 3 |
| قاعدة البيانات | SQLAlchemy 2.x ORM + Alembic، والافتراضي SQLite (WAL). متجرّب على PostgreSQL 16، وجاهز لـ MySQL/MariaDB وSQL Server |
| الواجهة | HTML5 + CSS Variables + JavaScript Vanilla (بدون Framework) |
| Excel / CSV | pandas + openpyxl |
| Word | python-docx (بدل docxtpl) |
| PDF | LibreOffice headless، ولو مش موجود بيجرب docx2pdf |
| الخطوط | Cairo، IBM Plex Sans Arabic (Google Fonts، ولو مفيش نت بيرجع لخطوط النظام) |

---

## 4. خريطة الكود

| الملف | القسم | أهم الدوال |
|---|---|---|
| `js/core.js` | CORE / STATE، THEME، VIEW PERMISSIONS، UI LANGUAGE، BACKUP، UI STATE، DRAFT AUTOSAVE، DOCUMENT COMPLETENESS، ALERT CENTER، GLOBAL SEARCH، NAV / RENDER | `reload`، `persist`، `t`، `translateDomText`، `toggleTheme`، `loadViewPerms`، `applyNavVisibility`، `trackedAlertItems`، `renderAlertCenterPanel`، `runGlobalSearch`، `empDocCompleteness`، `empUrgency`، `tierOf`، `datePill`، `saveDraft`، `attachDraftAutosave`، `daysSinceLastBackup`، `openConfirm`، `openBlockAlert`، `initCapabilities` |
| `js/dashboard.js` | DASHBOARD، RENEWAL CALENDAR، ORG CHART | `renderDashboard`، `collectAllTrackedDates`، `renderRenewalCalendarModal`، `renderOrgChartModal` |
| `js/employees.js` | EMPLOYEES VIEW، EMPLOYEE MODAL، DUPLICATE PREVENTION، BULK ASSIGN، المرفقات | `filteredEmployees`، `renderEmployees`، `openProfileCard`، `handleImportCsv`، `exportEmployeesCsv`، `printEmployeeReport`، `openEmployeeModal`، `renderAffRows`، `collectAffRows`، `findDuplicateCivilId`، `findDuplicatePassport`، `findDuplicateNameNationality`، `saveEmployee`، `openBulkAssignModal`، `openBulkRenewModal`، `openQuickRenewModal`، `openGovStageModal`، `loadDriveFiles`، `uploadFileForEmployee` |
| `js/org.js` | COMPANIES & PROJECTS، VEHICLES، COST CENTERS | `renderCompanies`، `openCompanyModal`، `openProjectModal`، `openSignatoryModal`، `openTrafficAuthModal`، `openCivilAffairsAuthModal`، `openCivilIdDocModal`، `renderVehicles`، `openVehicleModal`، `renderCostCenters`، `openCostCenterModal` |
| `js/contract.js` | CONTRACT GENERATOR، COMPANY LOG / AUDIT LOG | `renderContractView`، `buildContractHtml`، `renderCompanyLog` |
| `js/recruit.js` | RECRUITMENT، CANDIDATES REPORT + MODAL | `recruitStagesForSource`، `recruitStageInfo`، `migrateRecruitStages`، `renderRecruitFunnelCard`، `renderRecruitment`، `renderCandidatesReportModal`، `printCandidatesReport`، `openCandidateModal`، `convertCandidateToEmployee` |
| `models.py` / `db.py` / `db_transfer.py` | DATABASE (SQLAlchemy) | الموديلات، `session_scope`، `init_db`، `to_dict`، `apply`، `coerce`، `dump_state`، `export_tables`، `import_tables`، `transfer` |
| `docx_engine.py` | DOCX TEMPLATE ENGINE ⚠️ | `resolve_contract_template`، `fill_docx_template`، `docx_to_html`، `docx_to_pdf`، `replace_literals` |

> ⚠️ **محرك العقود** (`docx_engine.py`) **مُجمَّد**، وممنوع تعديله إلا بطلب صريح.

---

## 5. الشاشات (Views)

| `VIEW` | الشاشة | دالة العرض |
|---|---|---|
| `dashboard` | الصفحة الرئيسية | `renderDashboard` |
| `employees` | مركز إدارة الإقامات والموظفين | `renderEmployees` |
| `companies` | مركز إدارة الشركات والمشاريع | `renderCompanies` |
| `vehicles` | مركز إدارة السيارات | `renderVehicles` |
| `costcenters` | مراكز التكلفة | `renderCostCenters` |
| `contract` | عقد العمل | `renderContractView` |
| `recruitment` | الاستقدام والتوظيف | `renderRecruitment` |
| `companylog` | السجل التاريخي والتدقيق | `renderCompanyLog` |

**الشريط العلوي:** البحث الشامل (Ctrl+K)، مركز التنبيهات 🔔، الوضع الداكن/الفاتح، العربي/الإنجليزي، وقائمة المستخدم. القائمة فيها: النسخ الاحتياطي، الاستعادة (للمدير بس)، إدارة المستخدمين، إعدادات العرض، تغيير الباسورد، وتسجيل الخروج. وكمان شارة «وضع القراءة فقط».

---

## 6. نموذج البيانات

`GET /api/state` بيرجّع نفس شكل `STATE` في Lunx:

```json
{ "companies": [], "projects": [], "employees": [], "vehicles": [], "costCenters": [],
  "companyHistory": [], "candidates": [], "signatoryDocs": {}, "auditLog": [],
  "employeeTimeline": {}, "templates": [], "me": {}, "version": "", "pdfAvailable": true }
```

النماذج في `models.py`. اسم الخاصية في بايثون هو نفس اسم الحقل في الـ API (camelCase)، واسم العمود في قاعدة البيانات snake_case. التواريخ بنوع `Date`، والأوقات `DateTime`، والقيم المنطقية `Boolean`. `db.to_dict()` بتحوّل الكائن للـ API، و`db.apply()` بتحوّل القيم الجاية للنوع الصح.

| الجدول | ملاحظات |
|---|---|
| `employees` | `id` = **الرقم المدني**. كل حقول القسم 6.1، ومعاها حقول زيادة: `nationalityEn`، `professionEn`، `contractType`، `workPermitIssue`، `transferNote`، `iban`، `phone`، `notes` |
| `employee_affiliations` | `employee_id, position, company_id, project_id`. العنصر اللي `position = 0` هو الأساسي |
| `candidates` | كل حقول القسم 6.2 |
| `companies` | القسم 6.3، ومعاه `activity`. الشعار في `logo_path` |
| `signatories` | جدول لوحده مربوط بـ `company_id` (هو `companies[].signatories` في الـ API) |
| `company_docs` | `(company_id, kind)` ← الملف، و`kind` واحد من: `trafficAuth` / `civilAffairs` / `commercialLicense` |
| `signatory_docs` | مفتاحه الرقم المدني للمفوّض، والصورة بتتحفظ مرة واحدة لكل شخص |
| `projects`، `vehicles`، `cost_centers` | القسم 6.4. للسيارات حقلين زيادة: `model` و`notes` |
| `company_history`، `audit_log`، `employee_timeline` | السجلات، ومع كل واحدة اسم المستخدم (`user`) |
| `employee_files` | المرفقات (بدل Google Drive) |
| `templates` | قوالب Word، ومنها قالب واحد افتراضي (`is_default`) |
| `users` | المستخدمين والصلاحيات |

العلاقات زي القسم 6.5 بالظبط، ومراكز التكلفة لسه مربوطة **بالاسم**. لو غيّرت اسم مركز تكلفة، الاسم بيتحدّث لوحده عند كل الموظفين والمترشّحين.

---

## 7. القوائم الثابتة

نفس اللي في Lunx (موجودة في `js/core.js`):
- `GOV_STAGES`: 7 مراحل.
- `EMP_STATUS_LABELS`: 4 حالات.
- `RECRUIT_STAGES_OUTSIDE`: 9 مراحل.
- `RECRUIT_STAGES_INTERNAL`: 7 مراحل.
- `rejected`: مرحلة الرفض.
- `tierOf`: مستويات الخطورة `expired` / `d30` / `d60` / `d90` / `ok` / `none`.

---

## 8. قواعد العمل

### 8.1 تحويل المترشّح إلى موظف
التحويل بيحصل **فقط** لما تختار `all_completed`:
- لازم يكون فيه رقم مدني، وإلا الحفظ بيتمنع في الواجهة وفي السيرفر الاتنين.
- بتظهر نافذة تأكيد، وبعدها `POST /api/candidates/<id>/convert`.
- بيتعمل موظف بحالة `pending_completion`. بدل السكن بيتنقل كـ `included` بس، والمبلغ بيفضل `null`.
- المترشّح بيتشال، وبيتسجّل `candidate_convert` في سجل التدقيق.

### 8.2 منع التكرار (في الواجهة والسيرفر)

| الحقل | النطاق | النوع |
|---|---|---|
| الرقم المدني | الموظفين + المترشّحين | ⛔ منع |
| رقم الجواز | الموظفين + المترشّحين | ⛔ منع |
| رقم لوحة السيارة | السيارات | ⛔ منع |
| الاسم + الجنسية (عند إضافة مترشّح) | الموظفين + المترشّحين | ⛔ منع |
| الاسم + الجنسية (عند إضافة موظف) | الموظفين | ⚠️ تحذير. السيرفر بيرجّع 409 مع `warn`، والواجهة بتسأل، ولو وافقت بتبعت `force: true` |

مقارنة الأسماء بتتجاهل الفرق بين أ/إ/آ/ا، وة/ه، وى/ي، وبتتجاهل التشكيل.

### 8.3 التنبيهات
- **مركز التنبيهات** بيجمع كل حاجة هتنتهي خلال 90 يوم أو انتهت خلاص:
  - الإقامة، إذن العمل، الجواز، البطاقة الصحية، رخصة القيادة (للسائقين).
  - رخصة الشركة والتفويضين، وبطاقات المفوّضين.
  - المشاريع، وتأمين ودفتر السيارات.
  - للمترشّحين: التأشيرة، ومهلة الـ 60 يوم من الدخول، وإقامة الكفيل القديم.
- **شريط التنبيه:** بيظهر لو فيه تاريخ منتهي، أو تاريخ هينتهي خلال 7 أيام، أو موظف عنده `govStageNote`.
- **تذكير النسخ الاحتياطي:** بيظهر لو عدّى أكتر من 7 أيام من غير نسخة، وممكن تخفيه لليوم.
- **ميزة زيادة:** لما ترجع للتبويب، البيانات بتتحدّث لوحدها عشان تشوف تعديلات المستخدمين التانيين.

---

## 9. أنواع السجلات

**سجل التدقيق:**
- الموظفين: `employee_add` · `employee_edit` · `employee_delete`
- المترشّحين: `candidate_add` · `candidate_edit` · `candidate_convert`
- الشركات: `company_add` · `company_edit` · `company_delete`
- السيارات: `vehicle_add` · `vehicle_edit` · `vehicle_delete`
- النسخ الاحتياطي: `backup_restore`

**السجل التاريخي للشركات:**
`company_created` · `license_renewed` · `traffic_auth` · `civil_affairs_auth` · `signatory_added` · `project_added` · `project_renewed` · `residency_renewed`

**السجل الزمني للموظف:**
`create` · `edit` · `renew` · `gov_stage` · `assign` · `file` · `import_add` · `import_update`

---

## 10. التخزين المحلي (localStorage)

نفس المفاتيح:
- `mv_theme` و`mv_lang`: الوضع واللغة.
- `mv_lastView` و`mv_uiState`: آخر شاشة والفلاتر.
- `mv_viewPerms`: الأقسام المخفية ونطاق الشركات.
- `mv_draft_employee` و`mv_draft_candidate`: المسودات.
- `mv_last_backup` و`mv_backup_reminder_dismiss`: تذكير النسخ الاحتياطي.

---

## 11. محرك عقود العمل (Word)

```
templates_docs/contract_template_v2.docx   (معمول من «عقد حكومي بدل سكن» الأصلي بتنسيقه)
      │
resolve_contract_template(emp, company, signatory, project, date) ──► 22+ حقل
      │   employee_name(_en), nationality(_en), civil_id, profession(_en), salary, housing_amount,
      │   start_date, day_name(_en), company_name(_en), labor_office, file_number, project_name,
      │   auth_name(_en), auth_civil_id, passport_no, residency_exp, today
      │   + أسماء قديمة: sponsor, status, end_date
      ▼
fill_docx_template()  ← {{ field }} حتى لو متقسّم على أكتر من run، مع الحفاظ على تنسيق أول run، + MERGEFIELD
      ▼
/api/contract/docx  ·  /api/contract/pdf  ·  /api/contract/preview (HTML)
```

- الشركة والمفوّض واليوم بقوا بيتعبّوا **تلقائي**. في القالب القديم كانوا مكتوبين ثابتين (أبراج انرجي / عبدالعزيز المطيري / الأحد).
- القالب القديم `contract_template.docx` لسه موجود ويشتغل. `replace_literals()` بتحوّل أي عقد حقيقي لقالب من غير ما تبوّظ تنسيقه.
- قاموسي `PROFESSION_EN` و`NATIONALITY_EN` بيكمّلوا الإنجليزي لو ناقص.

---

## 12. الترجمة
- قاموس `I18N` في `static/i18n.js`، مفتاحه النص العربي.
- `t(ar)` بترجّع الترجمة.
- `translateDomText()` بتترجم النصوص والـ placeholder والـ title بعد كل عرض، وبتفهم النصوص اللي قبلها أيقونة زي 📤 أو ✅.
- البيانات نفسها (الأسماء والجنسيات) مش بتتترجم، والاسم الإنجليزي بيظهر لو موجود.

---

## 13. الـ API

| Method | المسار | الوصف |
|---|---|---|
| GET | `/api/state` | كل البيانات |
| POST / PUT / DELETE | `/api/employees[/<id>]` | الموظفين (مع منع التكرار) |
| POST | `/api/employees/bulk-assign` | تعيين جماعي |
| POST | `/api/employees/renew` | تجديد سريع أو جماعي |
| POST | `/api/employees/<id>/gov-stage` | مرحلة المعاملة |
| POST | `/api/employees/import` | استيراد Excel/CSV |
| GET / POST | `/api/employees/<id>/files` | المرفقات |
| POST / PUT / DELETE | `/api/companies`، `/api/projects`، `/api/signatories`، `/api/vehicles`، `/api/cost-centers`، `/api/candidates` | CRUD |
| POST | `/api/companies/<id>/docs/<kind>` | مستندات الشركة والشعار (`kind=logo`) |
| POST | `/api/signatory-docs/<civilId>` | بطاقة المفوّض |
| POST | `/api/candidates/<id>/convert` | تحويل لموظف |
| GET | `/api/contract/preview`، `/docx`، `/pdf` | العقود. البارامترات: `emp`، `tpl`، `company`، `sig`، `date`، `salary` |
| POST / DELETE | `/api/templates[/<id>]`، `/api/templates/<id>/default` | القوالب |
| GET / POST | `/api/backup`، `/api/restore` | النسخ الاحتياطي (JSON لكل الجداول) |
| GET / POST / PUT / DELETE | `/api/users` | المستخدمين (للمدير بس) |

---

## 14. الاستيراد الأولي (`seed_import.py`)

**بيعمل الآتي:**
- **الشركات:**
  - «شركة أبراج انرجي للتجارة العامة والمقاولات»: رقم ملفها 3563650 (عقود أهلي)، ومفوّضها عبدالعزيز سلطان صقير المطيري.
  - «شركة أبراج سيرفيسز للتجارة العامة والمقاولات»: رقم ملفها 2472526.
- **المشاريع:** 4 مشاريع للعقود الحكومية (312201900166 / 112 / 111 / 167) تحت أبراج انرجي.
- **الموظفين:** من `manp.xlsx`، بشيتيه «Sheet1» و«ورقة1»، ومن جدول `contracts` القديم. الربط بالرقم المدني، والموظف بيتربط بالمشروع أو الشركة حسب رقم الملف.

> راجع ربط أرقام الملفات بالشركات والمشاريع من شاشة الشركات، لأن الربط ده اتعمل استنتاج من ملف Excel.

---

## 15. قاعدة البيانات (SQLAlchemy + Alembic)

### اختيار نوع القاعدة
النوع بيتحدد من متغير البيئة `LUNX_DATABASE_URL`. لو مش متحدد، بيستخدم `sqlite:///lunx.db`.

| النوع | الرابط | الحزمة المطلوبة | الحالة |
|---|---|---|---|
| SQLite | `sqlite:///C:/path/lunx.db` | (مدمجة) | ✅ متجرّب بالكامل |
| PostgreSQL 16 | `postgresql+psycopg://user:pass@host:5432/lunx` | `psycopg[binary]` | ✅ متجرّب بالكامل |
| MySQL / MariaDB | `mysql+pymysql://user:pass@host/lunx?charset=utf8mb4` | `PyMySQL` | ⚠️ الـ SQL اتولّد واتراجع، لكن ما اتشغلش على سيرفر حقيقي |
| SQL Server | `mssql+pyodbc://user:pass@host/lunx?driver=ODBC+Driver+18+for+SQL+Server` | `pyodbc` | ⚠️ الـ DDL اتولّد واتراجع، لكن ما اتشغلش على سيرفر حقيقي |

### تصميم الهيكل
- **الأنواع:**
  - النصوص العربي بنوع `Unicode` / `UnicodeText`. على SQL Server بتبقى `NVARCHAR`، عشان العربي ما يتحولش لـ `؟`.
  - التواريخ بنوع `Date`، والأوقات `DateTime`، ونعم/لا `Boolean`.
- **المفاتيح الأجنبية (9 علاقات):**
  - الربط: شركة ← مشروع / مفوّض / مستند / سيارة / مترشّح / انتماء، وموظف ← انتماء / سيارة، ومشروع ← انتماء.
  - كلها `NO ACTION`: الحذف والتعديل بيتعملوا من كود التطبيق بالترتيب الصح، عشان يشتغلوا على كل الأنواع. SQL Server بيرفض مسارات الـ CASCADE المتعددة.
- **بدون مفاتيح أجنبية عن قصد:**
  - السجلات (`audit_log`، `company_history`، `employee_timeline`) والمرفقات، عشان التاريخ يفضل موجود بعد الحذف.
  - مراكز التكلفة، لأنها مربوطة بالاسم.
- **أسماء القيود والفهارس ثابتة** (`naming_convention` في `models.py`)، عشان أي تعديل بعد كده يشتغل بنفس الشكل على كل الأنواع.
- **تغيير الرقم المدني:** بيتعمل صف جديد بالرقم الجديد، وبعدين كل المراجع بتتحوّل له، وبعدين الصف القديم بيتحذف.

### تعديلات الهيكل (Alembic)
| المراجعة | المحتوى |
|---|---|
| `0001` | الهيكل الكامل (17 جدول) من غير مفاتيح أجنبية |
| `0002` | تنظيف المراجع اليتيمة، وبعدين إضافة المفاتيح الأجنبية التسعة |

- **التطبيق تلقائي:** السيرفر بيطبّق التعديلات لوحده كل ما يشتغل (`db.init_db()`).
- **حسب حالة القاعدة:**
  - قاعدة فاضية: بتتبني كاملة.
  - قاعدة v353-flask.2: بتتعلّم على `0001` وتكمّل.
  - قاعدة v353-flask.1 (sqlite3): بيتاخد منها نسخة `lunx.v1-backup-<التاريخ>.db`، والبيانات بتتنقل للهيكل الجديد.
- **لو ضفت أو غيّرت عمود:** عدّل `models.py`، وبعدين:
  ```bash
  python manage_db.py revision "إضافة عمود كذا"    # بيولّد ملف في migrations/versions — راجعه
  python manage_db.py upgrade
  ```
- **في SQLite** Alembic بيعيد بناء الجدول لوحده (batch mode)، فأي تعديل بيشتغل عليه كمان.

### أداة الإدارة `manage_db.py`
| الأمر | الوظيفة |
|---|---|
| `info` | نوع القاعدة، ومراجعة الهيكل، وعدد الصفوف في كل جدول |
| `check` | فحص السلامة: مراجع يتيمة، وجوازات مكررة، وموظفين من غير شركة |
| `upgrade` / `downgrade <rev>` / `history` | تعديلات الهيكل |
| `revision "وصف"` | توليد migration من الفرق بين `models.py` والقاعدة |
| `backup [ملف]` / `restore ملف` | نسخة كاملة بالمستخدمين، واستعادة أي صيغة |
| `transfer <من> <إلى>` | نقل كل البيانات بين أي نوعين |

### النقل من قاعدة لقاعدة
```bash
python manage_db.py transfer sqlite:///lunx.db "postgresql+psycopg://lunx:PASS@localhost/lunx"
```
- الأداة بتبني الهيكل في الهدف عن طريق Alembic.
- بتقرا المصدر بالـ reflection، فأي إصدار قديم ينفع.
- بتحوّل الأنواع وترتّب الإدخال حسب المفاتيح الأجنبية.
- الجداول في الهدف بتتمسح الأول، وده بيشمل المستخدمين.
- مجلد `uploads/` ملفات على القرص وملوش علاقة بالقاعدة، فانقله زي ما هو.

### النسخ الاحتياطي
- **تلقائي يومي:** أول طلب في اليوم بيعمل نسخة JSON كاملة (بالمستخدمين) في `backups/`.
  - بيحتفظ بآخر 30 نسخة، وده ممكن يتغيّر من `LUNX_BACKUP_KEEP`.
  - مكان الحفظ ممكن يتغيّر من `LUNX_BACKUP_DIR`.
- **يدوي:** من الواجهة (👤 ← نسخة احتياطية)، أو `python manage_db.py backup`.
- **الاستعادة بتقبل:**
  - نسخ الإصدار ده.
  - نسخ v353-flask.1 و.2.
  - نسخة Lunx القديمة (STATE).
- **المراجع اليتيمة** (زي سيارة سواقها اتحذف) بتتفضّى تلقائي وقت الاستعادة، وعددها بيظهر في النتيجة.

> ممنوع أي SQL خاص بنوع قاعدة معيّن في الكود. أي استعلام يتكتب بالـ ORM أو بـ `select()`، وأي تغيير في الهيكل يتعمل بـ migration.

## 16. استعادة نسخة احتياطية من Lunx (نسخة الملف الواحد)

ملف الـ JSON اللي بيطلع من زرار النسخ الاحتياطي في Lunx القديم (شكل `STATE`) بيترجع بطريقتين:
- **من الواجهة:** 👤 ← «استعادة نسخة احتياطية». السيرفر بيتعرّف على الشكل لوحده.
- **من سطر الأوامر:** `python lunx_restore.py "lunx-backup.json"`

الاستعادة بتستبدل كل البيانات. المستخدمين وقوالب العقود بيفضلوا زي ما هم، والملفات المضمّنة (الشعارات، مستندات الشركات، بطاقات المفوّضين) بتتحفظ في `uploads/`.

## 17. التشغيل في Docker (الإنتاج)

### الملفات
| الملف | الوظيفة |
|---|---|
| `Dockerfile` | صورة Python 3.12 slim + gunicorn + psycopg. بتشتغل بمستخدم `lunx` مش root، ووقتها `TZ=Asia/Kuwait`. `WITH_PDF=1` بيضيف LibreOffice وخطوط عربي (Noto وKacst) لتحويل العقود PDF |
| `docker-entrypoint.sh` | `serve`: بيطبّق تعديلات الهيكل مرة واحدة، وبعدين بيشغّل gunicorn · `manage <أمر>`: أوامر `manage_db.py` · `import-sqlite <ملف>`: بينقل بيانات lunx.db القديمة |
| `docker-compose.yml` | Lunx + PostgreSQL 16، ومعاهم volumes للبيانات |
| `docker-compose.sqlite.yml` | Lunx لوحده بـ SQLite (worker واحد) |
| `.env.example` | الإعدادات. انسخه إلى `.env` (مش بيترفع على GitHub) |
| `requirements-docker.txt` | المتطلبات، ومعاها gunicorn وpsycopg |

### أول تشغيل
```bash
cp .env.example .env              # غيّر POSTGRES_PASSWORD و LUNX_SECRET و LUNX_ADMIN_PASSWORD
docker compose up -d --build
docker compose logs -f app
```
افتح `http://السيرفر:5050`.

### نقل البيانات الحالية (من ويندوز) للـ container
حط `lunx.db` وفولدر `uploads/` في فولدر واحد، مثلًا `C:\lunx-import`، وبعدين:
```bash
docker compose run --rm -v C:/lunx-import:/import app import-sqlite /import/lunx.db
```
الأمر ده بينقل كل الجداول لـ PostgreSQL، وبينسخ المرفقات لـ volume البيانات، وبعدين بيعمل فحص سلامة. بعدها `docker compose up -d`.

### أين البيانات؟
| المكان | المحتوى |
|---|---|
| volume `pgdata` | قاعدة PostgreSQL |
| volume `lunxdata` ← `/data` | `uploads/`، و`templates_docs/` (القوالب المرفوعة)، و`backups/` (نسخ JSON يومية)، و`lunx.db` في وضع SQLite |

الكود جوه الـ image. تحديث النسخة (`docker compose up -d --build`) مش بيلمس البيانات، وتعديلات الهيكل بتتطبق لوحدها قبل ما السيرفر يشتغل.

### أوامر مفيدة
```bash
docker compose exec app ./docker-entrypoint.sh manage info
docker compose exec app ./docker-entrypoint.sh manage check
docker compose exec app ./docker-entrypoint.sh manage backup /data/backups/manual.json
docker compose exec db pg_dump -U lunx lunx > lunx.sql          # نسخة SQL من PostgreSQL
```

### متغيرات البيئة
| المتغير | الافتراضي | الوصف |
|---|---|---|
| `LUNX_DATABASE_URL` | `sqlite:////data/lunx.db` | رابط القاعدة |
| `LUNX_DATA_DIR` | `/data` (في Docker) | مكان البيانات المتغيّرة |
| `LUNX_SECRET` | (مطلوب) | مفتاح الجلسات. لو اتغيّر، كل المستخدمين هيخرجوا |
| `LUNX_ADMIN_PASSWORD` | `admin123` | كلمة سر admin **أول مرة بس** |
| `LUNX_AUTO_MIGRATE` | `0` في Docker و`1` محليًا | تطبيق تعديلات الهيكل عند تحميل التطبيق |
| `LUNX_BEHIND_PROXY` / `LUNX_COOKIE_SECURE` | `0` | خليهم `1` ورا Nginx/Traefik بـ HTTPS |
| `LUNX_BACKUP_KEEP` / `LUNX_BACKUP_DIR` | `30` / `/data/backups` | النسخ اليومية |
| `LUNX_MAX_UPLOAD_MB` | `25` | أقصى حجم مرفق |
| `WORKERS` / `THREADS` / `TIMEOUT` | `3` / `4` / `120` | إعدادات gunicorn |

- **فحص الحالة:** `GET /healthz`، ومستخدم في `HEALTHCHECK` جوه الصورة.
- **النسخة اليومية:** بيعملها worker واحد بس، عن طريق قفل ملف يومي في `backups/`.

## 18. قائمة الفحص قبل أي تحديث
1. تأكد إن ملفات الـ JS سليمة:
   ```bash
   for f in static/js/*.js; do node --check $f; done
   ```
2. خد نسخة احتياطية من `lunx.db` ومن مجلد `uploads/`.
3. اختبر الـ 8 شاشات بالعربي والإنجليزي، وافتح Console المتصفح وتأكد إن مفيش أخطاء.
4. متعدّلش `docx_engine.py` إلا بطلب صريح.
