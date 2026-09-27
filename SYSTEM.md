# Lunx: هيكل النظام (نسخة Flask)

**شركة أبراج انرجي ومجموعة شركاتها التابعة**
الإصدار: **v353-flask.4** · مبني على مواصفات Lunx v353 · تاريخ التوثيق: 2026-09-25

دي نفس وثيقة Lunx بعد ما اتظبطت على مشروع **zahed**. الشاشات والكيانات وقواعد العمل زي ما هي، والمعمارية بقت سيرفر Flask مع SQLAlchemy بدل ملف HTML واحد، وتقدر تشغّلها على SQLite أو PostgreSQL أو MySQL أو SQL Server.

---

## 1. التشغيل

```bash
pip install -r requirements.txt
python seed_import.py      # أول مرة بس: بيستورد data/manp.xlsx + data/legacy_database.db
python app.py              # http://localhost:5050
```
أو على ويندوز: دبل كليك على `run_windows.bat`.

**الشبكة:** `python app.py` لوحده بيسمع على `127.0.0.1` (الجهاز ده بس). `run_windows.bat` فيه `set HOST=0.0.0.0` فالأجهزة التانية على نفس الشبكة تقدر تفتحه، ورسالة التشغيل بتطبع عنوان الشبكة لوحدها (`lan_ip()`). عشان تقفله على الجهاز ده بس، امسح السطر ده.

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
| `CAP.user` + وضع القراءة فقط | تسجيل دخول بأدوار وصلاحيات مرنة ونطاق شركات لكل مستخدم، والسيرفر هو اللي بيفرضها (القسم 19) |
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
| `pdf_forms.py` | النماذج الرسمية PDF (الإقامة + رخصة القيادة) | `prepare_base`، `residency_values`، `driving_values`، `split_name`، `fill`، `needs_residency`، `governorate_of` |
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

**الشريط العلوي:** البحث الشامل (Ctrl+K)، مركز التنبيهات 🔔، الوضع الداكن/الفاتح، العربي/الإنجليزي، وقائمة المستخدم. القائمة فيها: اسم المستخدم ووظيفته، والنسخ الاحتياطي (للي مسموح له)، والاستعادة والمستخدمين والصلاحيات (للمدير بس)، وإعدادات العرض، وتغيير الباسورد، وتسجيل الخروج.

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
| `cost_centers` | معاه `company_id`: الشركة الفعلية لموظفين المركز (القسم 19) |
| `signatures` | صورة توقيع لكل رقم مدني، مفوّض أو موظف (القسم 11) |
| `roles` | الأدوار، والصلاحيات JSON (القسم 19) |
| `users` | المستخدمين: الدور (`role_id`)، `all_companies`، `active`، الوظيفة، آخر دخول |
| `user_companies` | نطاق الشركات للمستخدم لو `all_companies = false` |
| `user_cost_centers` | مراكز تكلفة في نطاق المستخدم، زيادة على الشركات |

العلاقات زي القسم 6.5 بالظبط، ومراكز التكلفة لسه مربوطة **بالاسم**. لو غيّرت اسم مركز تكلفة، الاسم بيتحدّث لوحده عند كل الموظفين والمترشّحين.

---

## 7. القوائم الثابتة

نفس اللي في Lunx (موجودة في `js/core.js`):
- `GOV_STAGES`: 7 مراحل.
- `EMP_STATUS_LABELS`: 4 حالات.
- `RECRUIT_STAGES_OUTSIDE`: 10 مراحل («عقد العمل» بين تصديق الخارجية وإصدار إذن العمل).
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

### 8.1.1 عقد عمل المترشّح (مرحلة «عقد العمل»)
- المرحلة `employment_contract` موجودة في النقل الداخلي (أول مرحلة) والاستقدام من الخارج (قبل «إصدار إذن العمل»).
- أول ما تختارها في نافذة المترشّح بيظهر صندوق «📄 عقد العمل»، وبيقول الناقص وإنت بتكتب. وفيه أيقونة 📄 في صف المترشّح في الجدول. الاتنين بيظهروا بس للي معاه `contract.view` + `sensitive.salary`، وفي المرحلة دي بس.
- **أي نقص = ممنوع:** زرار «طباعة عقد العمل» مابيفتحش العقد لو ناقص الرقم المدني («أدخل الرقم المدني للمترشّح عشان تعمل العقد») أو الاسم أو الاسم بالإنجليزي أو الجنسية أو المهنة أو الراتب أو الشركة المستهدفة. لو كامل، بيحفظ تعديلات النافذة الأول وبعدين يفتح نافذة العقد.
- **نافذة العقد (`openCandidateContractModal`):** نفس القوالب. الطرف الأول = الشركة المستهدفة، والمفوّض = أولهم فيها أو اللي تختاره، وتاريخ العقد الافتراضي النهارده، وبند السكن من «بدل السكن». الاسم والراتب من بيانات المترشّح بس. المهنة/الجنسية بالإنجليزي بتظهر خانتهم لو القاموس ماعرفهمش. أي حقل القالب بيستخدمه وفاضي (`contracts.missing_in_template`) بيقفل Word/PDF، والسيرفر بيرفض كمان.
- تاريخ العقد مابيتحفظش على المترشّح، ومالوش علاقة بتاريخ التعيين.
- كل تنزيل Word/PDF بيتسجّل `candidate_contract` في سجل التدقيق.

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
  - لو أكتر من مستند لنفس الشخص/الشركة/السيارة بينتهي في نفس اليوم (زي الإقامة وإذن العمل) بيظهروا سطر واحد: "الإقامة + إذن العمل". العدّاد على 🔔 والتقويم بيعدّوا السطور دي.
- **شريط التنبيه:** بيظهر لو فيه تاريخ منتهي، أو تاريخ هينتهي خلال 7 أيام، أو موظف عنده `govStageNote`.
- **تذكير النسخ الاحتياطي:** بيظهر لو عدّى أكتر من 7 أيام من غير نسخة، وممكن تخفيه لليوم.
- **ميزة زيادة:** لما ترجع للتبويب، البيانات بتتحدّث لوحدها عشان تشوف تعديلات المستخدمين التانيين.

---

## 9. أنواع السجلات

**سجل التدقيق:**
- الموظفين: `employee_add` · `employee_edit` · `employee_delete` · `employee_residency_form` · `employee_driving_form` · `employee_clearance`
- المترشّحين: `candidate_add` · `candidate_edit` · `candidate_convert` · `candidate_contract` · `candidate_driving_form`
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
- `mv_viewPerms`: الأقسام المخفية من القائمة (تفضيل شخصي بس. الصلاحيات ونطاق الشركات على السيرفر).
- `mv_draft_employee` و`mv_draft_candidate`: المسودات.
- `mv_last_backup` و`mv_backup_reminder_dismiss`: تذكير النسخ الاحتياطي.

---

## 11. محرك عقود العمل (Word / PDF)

```
templates_docs/contract_reference.docx     (عقد العمل — القطاع الأهلي: القالب الوحيد والافتراضي)
      │
resolve_contract_template(emp, company, signatory, project, date) ──► 22+ حقل
      │   employee_name(_en), nationality(_en), civil_id, profession(_en), salary, housing_amount,
      │   start_date, day_name(_en), company_name(_en), labor_office, file_number, project_name,
      │   auth_name(_en), auth_civil_id, passport_no, residency_exp, today
      │   + أسماء قديمة: sponsor, status, end_date
      ▼
contracts.extra_context()  ← labor_office_en + ترجمات تكميلية للمهنة والجنسية (contracts.py)
      ▼
fill_docx_template()  ← {{ field }} حتى لو متقسّم على أكتر من run، مع الحفاظ على تنسيق أول run، + MERGEFIELD
      ▼
/api/contract/docx  ·  /api/contract/pdf  ·  /api/contract/preview (HTML)  ·  /api/contract/batch (PDF واحد / ZIP)
```

- **قالب واحد بس:** `contract_reference.docx` معمول من ملف «عقد عمل.docx» اللي اتبعت (2026-09-27). القالبين الحكوميين القدام (`contract_template.docx` و`contract_template_v2.docx`) اتشالوا: `bootstrap()` بيمسح سجلاتهم (`RETIRED_TEMPLATES`) وملفاتهم من `templates_docs` في مجلد البيانات، ولو مفيش قالب افتراضي بيخلّي أول قالب هو الافتراضي. القوالب اللي جاية مع الكود بتتحدّث في مجلد البيانات لو محتواها اتغيّر (Docker)، والمرفوعة من الشاشة ليها أسماء تانية فمابتتلمسش.
- **إدارة العمل:** من المشروع لو الموظف على مشروع ليه إدارة عمل (مشاريع الحكومة ← «إدارة عمل العقود والمشاريع الحكومية»)، وإلا من الشركة. المترشّح مالوش مشروع ← من الشركة المستهدفة. `labor_office_en` بيتحسب من الاسم العربي (المحافظة أو العقود الحكومية).
- الشركة والمفوّض واليوم بيتعبّوا **تلقائي**. `replace_literals()` بتحوّل أي عقد حقيقي لقالب من غير ما تبوّظ تنسيقه.
- قاموسي `PROFESSION_EN` و`NATIONALITY_EN` بيكمّلوا الإنجليزي لو ناقص. ولأن المحرك مُجمَّد، `contracts.py` فيه قاموس تكميلي (`PROFESSION_EN_EXTRA` / `NATIONALITY_EN_EXTRA`). القاموس ده بيتستخدم بس لو القيمة لسه فاضية، واللي مكتوب في «المهنة (إنجليزي)» عند الموظف بيكسب دايمًا.
- **العقد المرجعي:** الأصل كان فيه حقول بأسماء عربي (`{{الاسم العربي}}`) وإنجليزي (`{{Salary}}`)، والمحرك مابيقراش غير `[a-zA-Z0-9_]`. فالأسماء اتغيّرت بـ `replace_literals()` لأسماء المحرك (22 حقل)، والنص والتنسيق زي ما هم بالظبط. جملة بدل السكن في البند 13 بس اللي بقت حقل. `labor_office_en` حقل جديد (مثلًا «Manpower - Ahmadi Governorate Labour Department»).
- **PDF (`contracts.py`):** بيستخدم LibreOffice لو موجود (في Docker)، وإلا Microsoft Word عن طريق COM على ويندوز (`pywin32`). عقود الدفعة كلها بتتحول في جلسة واحدة، وبتتدمج بـ `pypdf` بترتيب الاختيار. السرعة حوالي ثانية للعقد مع Word.
- **عقود متعددة:** من شاشة العقد («📚 عقود متعددة») أو من شريط التحديد في شاشة الموظفين («📄 عقود المحدد»):
  - **التاريخ:** تاريخ واحد للكل، أو تاريخ تعيين كل موظف.
  - **الشركة (الطرف الأول):** الافتراضي هو الشركة المسجّل عليها كل موظف، أو شركة واحدة تختارها لكل العقود. لو الشركة اتغيّرت، مشروع الموظف مابيدخلش في العقد، وإدارة العمل بتتاخد من الشركة المختارة.
  - **المفوّض بالتوقيع:** الافتراضي هو أول مفوّض في شركة كل عقد، أو أي مفوّض تختاره حتى لو من شركة تانية (حرية اختيار). مفوّضين الشركة المختارة بيظهروا الأول، والشخص نفسه مابيتكررش. لو المفوّض المختار مش مسجّل في شركة العقد (بالرقم المدني)، الفحص بينبّه قبل التجهيز.
  - **المستخدم المحصور:** مايقدرش يختار شركة أو مفوّض برّه نطاقه.
  - **قبل التجهيز:** `/api/contract/batch/check` بيعرض الناقص.
  - **النتيجة:** معاينة PDF أو طباعة أو تنزيل ملف واحد، أو **«PDF لكل موظف»** (ملف منفصل باسم كل موظف: «عقد عمل - الاسم - الرقم المدني.pdf»، بيتحوّلوا كلهم في جلسة واحدة وبيتنزّلوا ورا بعض، والمتصفح ممكن يسأل مرة «السماح بتنزيل ملفات متعددة»)، أو ZIP فيه ملفات Word بنفس الأسماء.
  - **الحد:** `LUNX_CONTRACT_BATCH_MAX` (الافتراضي 300)، وكل دفعة بتتسجل في سجل التدقيق.
- **بند بدل السكن (البند الثالث عشر، اختياري):** الجملة بقت حقل `{{housing_clause}}` / `{{housing_clause_en}}` في القالب.
  - النص: «يتضمن الأجر الشهري المنصوص عليه في البند الرابع من هذا العقد بدل سكن.» / «The monthly remuneration provided for in Clause Four of this contract includes a housing allowance.»
  - من غير البند بيتكتب «لايوجد» / «NONE» زي البندين 2 و3.
  - البارامتر `housing`: `1` يُضاف (الافتراضي)، `0` لا يُضاف، `auto` حسب «بدل السكن مشمول» عند الموظف.
  - في الواجهة: مربع اختيار في العقد الفردي، واختيار من التلاتة في العقود المتعددة.
- **التوقيعات:** صورة توقيع واحدة لكل رقم مدني (جدول `signatures`، ترحيل `0005`)، سواء كان مفوّض أو موظف.
  - **الرفع:** المفوّض من شاشة الشركات (زر «✍️ التوقيع» جنب كل مفوّض)، والموظف من ملفه في تبويب «المستندات والتواريخ».
  - **في القالب:** `{{sig_first_party}}` و`{{sig_second_party}}` في أول سطر فاضي تحت «الطرف الأول» و«الطرف الثاني». المحرك بيحط مكانهم علامة، و`contracts.apply_signatures()` بتحط الصورة (ارتفاع 1.4 سم، وعرض لحد 5 سم) أو تشيل العلامة.
  - **القالب الحالي فيه المكانين** (اتضافوا 2026-09-27 في أول سطر فاضي تحت «الطرف الأول» و«الطرف الثاني»، والعقد بيفضل صفحتين بالتوقيعين). `/api/state` بيقول لكل قالب `signFirst` / `signSecond` (القالب فيه الحقل ولا لأ)، ومربعات «بتوقيع المفوّض» / «بتوقيع الموظف» في الشاشات بتظهر بس لو القالب المختار فيه مكانها ولمن معاه صلاحية «توقيعات المفوّضين والموظفين» (`contract.sign`). من غير علامة ← العقد بخانة توقيع فاضية.
  - **الصفحات:** بعد صورة الطرف الأول بيتشال سطرين فاضيين، عشان العقد يفضل صفحتين.
  - **على العقد:** `signFirst` / `signSecond` (مربعات «بتوقيع المفوّض / الموظف» في العقد الفردي والمتعدد). الفحص قبل الدفعة بيعدّ اللي مالهمش توقيع مرفوع، وخانتهم بتفضل فاضية.
  - **صلاحيات الرفع والعرض:** توقيع المفوّض (`companies.edit` للرفع، و`companies.view` أو `contract.view` للعرض، في شركة من النطاق). توقيع الموظف (`employees.edit` + `sensitive.documents` للرفع، و`employees.view` + `sensitive.documents` للعرض، والموظف في النطاق).
- **الصلاحيات:** العقود (فردي ومتعدد) محتاجة `contract.view` و`employees.view` و`sensitive.salary`، وكل موظف لازم يكون في نطاق المستخدم. **والعقود بالتوقيعات** محتاجة كمان `contract.sign`، ودي اتضافت لدوري «محرر» و«موارد بشرية».

### 11.1 النماذج الرسمية (PDF): الإقامة ورخصة القيادة — `pdf_forms.py`
- **الملفات** في `forms/`: النموذج الرسمي فاضي (من غير تشفير ومن غير البيانات التجريبية اللي كانت فيه — نموذج الرخصة كان فيه بيانات شخص حقيقي)، و`NeedAppearances` شغال. اتعملوا مرة واحدة بـ `pdf_forms.prepare_base(الأصل، الوجهة)` (فك تشفير نموذج الإقامة محتاج `cryptography` وقتها بس).
  - `residency_2018.pdf` — نموذج الإقامة الجديد 2018 (وزارة الداخلية، الإدارة العامة لشؤون الإقامة). للموظفين بس، ومش للكويتيين والخليجيين (`NO_RESIDENCY`).
  - `driving_license.pdf` — طلب إصدار رخصة القيادة + شهادتين لياقة طبية بنفس البيانات (الإدارة العامة للمرور). للموظفين والمترشّحين. قائمة «السنة» في الأصل من 1931 لـ 2002، واتضاف لها لحد 2010 (`DRIVING_EXTRA_YEARS`).
- **من فين:** بطاقة الموظف («🪪 نموذج الإقامة» للي معاه `sensitive.documents`، و«🚗 نموذج رخصة القيادة»)، ونافذة المترشّح («🚗 نموذج رخصة القيادة» — بيحفظ تعديلات النافذة الأول).
- **نافذة النموذج (`openOfficialFormModal`):** نوع الإجراء (الإقامة: «تجديد» افتراضي؛ الرخصة: خاصة / عامة / دراجة / إنشائية)، وتحته **البيانات الناقصة كخانات**:
  - اللي يتكتب فيها بيتحفظ في مكانه بالـ PUT العادي (بكل فحوصاته): الموظف أو المترشّح (لو معاه `employees.edit` / `recruitment.edit`)، والشركة (`companies.edit`) للرقم المدني للرخصة والرقم الموحد.
  - الخانة اللي مالهاش مكان (زي «عنوان العمل» للمترشّح) أو المستخدم مايقدرش يعدّلها مكتوب جنبها «(للنموذج بس)».
  - كل اللي اتكتب بيتبعت للنموذج كمان (`person` / `company` في الطلب، والسيرفر بيقبل بس `PERSON_KEYS` / `COMPANY_KEYS`)، فبيطلع فيه حتى لو ماتحفظش.
- **الإقامة بتتملى بـ:** الرأس («إقامة» · «عمل أهلي» · «18 عمل أهلي» · نوع الإجراء · المحافظة من إدارة العمل بتاعة الشركة)، المقيم (الرقم المدني، **رقم المرجع = الرقم الموحد**، الاسم عربي وإنجليزي، الميلاد، الجنس، مكان الميلاد، الجواز ونوعه «عادي» وتواريخه، الجنسية بكودها، العلاقة «عمل»، المهنة)، وصاحب العمل (الرقم المدني = الرقم المدني للرخصة، **رقم المرجع / الشخصية الاعتبارية = الرقم الموحد للشركة**، الاسم، «الكويت - 1»، المحافظة).
- **الرخصة بتتملى بـ:** نوع المعاملة، تاريخ النهارده، الرقم الموحد، الرقم المدني، الاسم متقسّم (`split_name`: الأول / الأب / الجد / الرابع / الأخير، و«عبد» و«أبو» بيتلزقوا في اللي بعدهم)، الجنسية، الجنس، الميلاد (يوم / شهر / سنة)، فصيلة الدم، المهنة، عنوان العمل (= «مكان العمل الفعلي»)، عنوان السكن، الهاتف النقال وهاتف المنزل، واسم الكفيل (الشركة المسجّل عليها / المستهدفة).
- **القوائم:** القيمة بتتطابق مع قائمة النموذج بالاسم (من غير الكود ومن غير «ال»، و`NATIONALITY_ALIASES` للأسماء المختلفة زي «بنغلاديش» ← «بنجلاديش - 145»). كل جنسيات الموظفين الحاليين متطابقة.
- **الخانات بتفضل قابلة للكتابة**، فأي حاجة تانية فاضية بتتكتب في المتصفح قبل الطباعة. النص العربي بيرسمه المتصفح نفسه (`/AP` بيتشال من الخانات المتعبّية) فبيطلع متوصّل.
- **البيانات الجديدة:**
  - الترحيل `0008` (الموظف): الجنس، مكان الميلاد، تاريخ إصدار الجواز.
  - الترحيل `0009`: الموظف والمترشّح — الرقم الموحد، فصيلة الدم، عنوان السكن (المنطقة / القطعة / الشارع / المنزل / الشقة)، هاتف المنزل، والمترشّح كمان الجنس. الشركة — الرقم الموحد.
  - كلها في نوافذ الموظف والمترشّح والشركة وبطاقاتهم، واستيراد Excel بنفس الأسماء («الجنس» بيقبل ذكر / أنثى / male / female / M / F). ولما المترشّح يتحوّل لموظف بتتنقل معاه (مع تاريخ إصدار الجواز).

### 11.2 إقرار مخالصة عمالية نهائية (استلام المستحقات) — الهيئة العامة للقوى العاملة
- **الملف:** `forms/clearance.docx` = النموذج الرسمي (عربي/إنجليزي) بحقول المحرك بعد العناوين، والتواريخ الفاضية («00/00/..20») بقت حقول. الحقول بتاخد تنسيق العنوان اللي قبلها. عشان يفضل صفحة واحدة: الهامش السفلي بقى 1.27 سم بدل 2.54، واتشال سطر فاضي واحد من سطرين تحت «أقر بأنني استلمت…».
- **بيتملى بمحرك العقود** (`_build_contract(..., extra, path)`): الاسم والجنسية والرقم المدني عربي وإنجليزي، الشركة ورقم الملف (نفس منطق العقد: ملف المشروع ← ملف الموظف ← الملف الرئيسي)، الفترة من تاريخ التعيين لتاريخ انتهاء الخدمة (`period_from` / `period_to`)، نوع الإجراء بعلامة ✔ (`proc_transfer` = الإلغاء والتحويل خارج القطاع، `proc_travel` = الإلغاء النهائي للسفر)، تاريخ الإقرار واليوم، والمفوّض بالتوقيع (عربي وإنجليزي).
- **التوقيعات:** «بتوقيع المفوّض» جنب «التوقيع:» في إقرار صاحب العمل، و«بتوقيع الموظف» جنب «التوقيع أو البصمة:» (`contract.sign`). ارتفاع الصورة هنا 1 سم (`sig_height`) بدل 1.4، وبعدها بيتشال السطر الفاضي — فالإقرار صفحة واحدة بكل الاحتمالات.
- **من فين:** زرار «🧾 إقرار مخالصة» في بطاقة الموظف (`employees.view`). النافذة: نوع الإجراء، تاريخ الإقرار (النهارده)، المفوّض، التوقيعات، والبيانات الناقصة (الاسم بالإنجليزي، الجنسية، تاريخ التعيين، تاريخ انتهاء الخدمة، اسم الشركة بالإنجليزي) بتتحفظ في مكانها بنفس `missingDataKit` بتاع النماذج الرسمية. النتيجة معاينة PDF أو تنزيل Word.
- **تاريخ انتهاء الخدمة** (`serviceEndDate`، الترحيل `0010`) في نافذة الموظف وبطاقته واستيراد Excel.

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
| POST | `/api/employees/<id>/clearance/<pdf\|docx>` | إقرار مخالصة عمالية نهائية. الجسم `{procedure: transfer\|travel, date, sig, signFirst, signSecond, person, company}` |
| POST | `/api/employees/<id>/forms/<residency\|driving>`، `/api/candidates/<id>/forms/driving` | النموذج الرسمي PDF متعبّي. الجسم `{action, person, company}` (البيانات اللي اتكتبت في النافذة). الإقامة محتاجة `sensitive.documents` ومرفوضة للكويتيين والخليجيين |
| POST / PUT / DELETE | `/api/companies`، `/api/projects`، `/api/signatories`، `/api/vehicles`، `/api/cost-centers`، `/api/candidates` | CRUD |
| POST | `/api/companies/<id>/docs/<kind>` | مستندات الشركة والشعار (`kind=logo`) |
| POST | `/api/signatory-docs/<civilId>` | بطاقة المفوّض |
| POST | `/api/candidates/<id>/convert` | تحويل لموظف |
| GET | `/api/candidates/<id>/contract/preview`، `/docx`، `/pdf` | عقد عمل المترشّح (مرحلة «عقد العمل» بس). البارامترات: `tpl`، `sig`، `date`، `housing`، `signFirst`، `professionEn`، `nationalityEn`. Word/PDF بيترفضوا لو فيه أي نقص |
| GET | `/api/contract/preview`، `/docx`، `/pdf` | العقود. البارامترات: `emp`، `tpl`، `company`، `sig`، `date`، `salary`. `pdf` من غير `dl=1` = معاينة |
| POST | `/api/contract/batch`، `/api/contract/batch/check` | عقود متعددة: `{emps, tpl, date, useHireDate, company, sig, housing, signFirst, signSecond, format: pdf\|zip\|files, dl}`. `files` ← JSON `{files: [{name, data (base64)}]}` |
| POST / DELETE | `/api/signatures/<civilId>`، GET `/files/signature/<civilId>` | صورة التوقيع (PNG/JPG أقل من 3MB) |
| POST / DELETE | `/api/templates[/<id>]`، `/api/templates/<id>/default` | القوالب |
| GET / POST | `/api/backup`، `/api/restore` | النسخ الاحتياطي (JSON لكل الجداول) |
| GET / POST / PUT / DELETE | `/api/users` | المستخدمين (للمدير بس) |
| GET / POST / PUT / DELETE | `/api/roles` | الأدوار + كتالوج الصلاحيات (للمدير بس) |

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
| `0008` | `employees`: `gender` (male / female)، `place_of_birth`، `passport_issue_date` — لنموذج الإقامة |
| `0010` | `employees.service_end_date` — تاريخ انتهاء الخدمة (إقرار المخالصة) |
| `0009` | `companies.unified_number`؛ `employees` و`candidates`: `unified_number`، `blood_type`، `address_*`، `home_phone`؛ و`candidates.gender` — للنماذج الرسمية |

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
   واختبرها كمان بمستخدم محدود (مثلًا «مندوب حكومي» على شركة واحدة).
4. متعدّلش `docx_engine.py` إلا بطلب صريح.

---

## 19. المستخدمين والأدوار والصلاحيات

الكود في `perms.py`، والجداول `roles` و`users` و`user_companies` (ترحيل `0003`).

### الفكرة
- كل مستخدم ليه **دور واحد**. الدور عبارة عن قائمة مفاتيح صلاحيات، ومدير النظام يقدر يعدّلها من 👤 ← «المستخدمين والصلاحيات» ← «الأدوار والصلاحيات».
- كل مستخدم ليه **نطاق**: يا كل الشركات، يا شركات محددة (`user_companies`) و/أو مراكز تكلفة محددة (`user_cost_centers`، ترحيل `0006`). مركز التكلفة مفيد لما يكون مالوش شركة مسجّلة، زي «سويبريور انرجي».
- **السيرفر هو اللي بيفرض كل ده.** اللي مش مسموح بيه مابيوصلش للمتصفح أصلًا في `/api/state`، وأي طلب تعديل برّه الصلاحية أو النطاق بيترفض بـ 403. الواجهة بتخفي الأزرار بس عشان الشكل.
- **الصلاحيات مابتظهرش لغير مدير النظام.**
  - **في الواجهة:** مفيش «صلاحياتي»، ولا اسم الدور أو نطاق الشركات في القائمة، ولا شارة «وضع القراءة فقط»، ولا رسايل بتقول «محتاج صلاحية». اللي مش مسموح بيختفي وخلاص (الشاشة من القائمة، والزر، والحقل الحساس).
  - **في `me`:** غير المدير مابيوصلوش `roleName` / `roleId` / `companies`، بس المفاتيح اللي الواجهة محتاجاها.
  - **رسايل الرفض (403):** محايدة («العملية دي غير متاحة»، «السجل ده غير متاح»).
  - **شاشة «عقد العمل»:** بتظهر بس لو معاه `contract.view` + `employees.view` + `sensitive.salary`.
  - **مرحلة «تم إنجاز جميع الإجراءات» في الاستقدام:** بتظهر بس للي يقدر يضيف موظفين.

### مفاتيح الصلاحيات
| المفتاح | المعنى |
|---|---|
| `<قسم>.view` / `.edit` / `.delete` | عرض / إضافة وتعديل / حذف. الأقسام: `employees`، `companies` (ومعاها المشاريع والمفوّضين والمستندات)، `vehicles`، `costcenters`، `recruitment`، و`contract` (عرض وتعديل بس: التعديل = إدارة القوالب)، و`companylog` (عرض بس) |
| `sensitive.salary` | المرتب وبدل السكن وتكلفة المعاملات، للموظفين والمترشّحين. وفرق الراتب في السجل بيظهر `•••` لو الصلاحية دي مش موجودة |
| `sensitive.bank` | البنك والـ IBAN |
| `sensitive.documents` | رقم الجواز ومرفقات الموظف |
| `system.import` | استيراد Excel/CSV. محتاج كمان `employees.edit` وكل البيانات الحساسة ونطاق كل الشركات |
| `system.backup` | تنزيل نسخة احتياطية. محتاج كمان كل البيانات الحساسة ونطاق كل الشركات |
| `contract.sign` | توقيعات المفوّضين والموظفين |

- التعديل أو الحذف بيضيف «عرض» لوحده.
- الدور اللي `is_admin` عنده كل الصلاحيات على كل الشركات، ومعاها إدارة المستخدمين والأدوار والاستعادة.

### قواعد مهمة
- **الحقول الحساسة وقت الحفظ:** لو المستخدم مش شايف حقل، قيمته بتتجاهل في الحفظ ومابتتمسحش. يعني المندوب لما يعدّل موظف، الراتب بيفضل زي ما هو.
- **العقد:** إنشاء العقد محتاج `contract.view` و`employees.view` و`sensitive.salary`، لأن العقد فيه الراتب.
- **نطاق الشركات:**
  - **الموظف:** يظهر لو **الشركة المسجّل عليها** (أي انتماء) في النطاق، **أو** لو **مركز التكلفة** بتاعه مربوط بشركة في النطاق. ده للموظف المسجّل على شركة وشغال فعليًا في شركة تانية.
    - كل مركز تكلفة ليه «الشركة الفعلية» (`cost_centers.company_id`) وبتتحدد من شاشة مراكز التكلفة. تحديدها محتاج نطاق كل الشركات، لأنها بتوسّع نطاق مستخدمين تانيين.
    - الشركة المسجّل عليها لو برّه النطاق بتوصل للمتصفح بالاسم بس (`outOfScope: true`)، وبتظهر في نموذج الموظف للقراءة بس. والسيرفر بيحافظ عليها حتى لو الطلب مابعتهاش، والأساسي بيفضل أساسي.
    - المستخدم المحدود مايقدرش يضيف للموظف شركة برّه نطاقه، ومايقدرش يحفظ الموظف بشكل يخرّجه من نطاقه (مثلًا يغيّر مركز التكلفة لمركز شركة تانية).
    - **أو** مركز التكلفة نفسه في نطاق المستخدم (`user_cost_centers`)، حتى لو المركز مالوش شركة.
    - نفس القاعدة على المترشّح: الشركة المستهدفة أو مركز التكلفة.
    - في جدول الموظفين: شارة **🏢 على الشركة** / **🏭 على مركز التكلفة** وعدادات بتفلتر. من غير اختيار شركة، 🏭 = شغال في شركة غير المسجّل عليها.
  - **السيارة:** لو من غير شركة، بتظهر بس للي نطاقه كل الشركات.
  - **إضافة شركة أو حذفها والاستيراد والنسخ الاحتياطي:** محتاجين نطاق كل الشركات.
  - **سجل التدقيق:** مش مربوط بشركة، فبيظهر بس للي نطاقه كل الشركات. السجل التاريخي للشركات بيتفلتر بالنطاق.
  - **رسائل التكرار:** للمستخدم المحدود مابتكشفش اسم شخص من شركة تانية.
- **إيقاف الحساب** (`active = false`): المستخدم بيخرج فورًا ومايقدرش يدخل تاني. ده أفضل من الحذف لأن اسمه بيفضل في السجلات.
- **حماية المدير:** لازم يفضل مدير نظام واحد نشط على الأقل، ومايقدرش المدير يشيل صلاحيته أو يوقف حسابه بنفسه.

### الأدوار الجاهزة (بتتعدّل)
| الدور | الصلاحيات |
|---|---|
| مدير النظام 🔒 | كل حاجة |
| محرر 🔒 | كل الأقسام بالكامل وكل البيانات الحساسة والاستيراد والنسخ الاحتياطي (نفس «editor» القديم) |
| مشاهد 🔒 | عرض كل الأقسام من غير البيانات الحساسة |
| موارد بشرية | الموظفين والاستقدام والعقود بالكامل، وعرض الشركات ومراكز التكلفة والسجل، وكل البيانات الحساسة، والاستيراد |
| مندوب حكومي | عرض وتعديل الموظفين والسيارات، وعرض الشركات، والجواز والمرفقات |
| استقدام | عرض وتعديل الاستقدام، وعرض الموظفين والشركات، والجواز |
| محاسب | عرض الموظفين والشركات والسجل، وتعديل مراكز التكلفة، والمرتب والبنك |

🔒 = «مدير النظام»: ده الدور الوحيد اللي مابيتحذفش. أي دور تاني المدير يقدر يحذفه، حتى محرر ومشاهد. ولو الدور عليه مستخدمين، لازم يختار دور ينتقلوا له (`DELETE /api/roles/<id>?moveTo=<id>`)، والنقل بيتسجل في سجل التدقيق. الترحيل حوّل المستخدمين القدام كالتالي: `admin` ← مدير النظام، `editor` ← محرر، `viewer` ← مشاهد.

### النسخ الاحتياطي
- `roles` و`users` و`user_companies` بيتعاملوا مع بعض: النسخة الكاملة فيها التلاتة، والاستعادة من الشاشة بتسيبهم زي ما هم.
- النطاق بيفضل لكل شركة لسه موجودة بعد الاستعادة.
- النسخ القديمة اللي فيها `users.role` نص بتتحوّل لوحدها للأدوار الجديدة.

---

## 20. تاريخ الموظف وتحركاته (`history.py`)

- **كل نقلة بتتسجل في الخط الزمني للموظف** بأسماء واضحة «من … إلى …»، وده بيحصل في:
  - تعديل الموظف
  - التعيين الجماعي
  - الاستيراد
  - التحويل من مترشّح
  - الإضافة
- **أنواع السطور:**

| النوع | مثال |
|---|---|
| `baseline` 🏁 | «بداية تسجيل التحركات — مسجّل على «A» (مشروع: …) · مركز التكلفة «X» (شغال فعليًا في: B)» |
| `create` 🆕 / `import_add` 📥 | إنشاء الموظف أو التحويل من مترشّح أو الاستيراد، ومعاه وضعه |
| `transfer` 🔀 | «انتقال: من «A» إلى «B»»، و«إضافة/إزالة شركة إضافية» |
| `project` 📁 | «تغيير المشروع في «A»: من … إلى …» |
| `cost_center` 💼 | «مركز التكلفة: من «X» (شغال فعليًا في: …) إلى «Y» (…)» |

- **سجل الشركات:** بيتسجل فيه `employee_left` للشركة القديمة و`employee_joined` للجديدة. ده بيحصل سواء اتغيّرت الشركة المسجّل عليها الموظف، أو الشركة الفعلية عن طريق مركز التكلفة.
- **سجل التدقيق:** التحركات بتدخل في سطر «تعديل موظف» أو «تعيين جماعي».
- **الواجهة:** تبويب «🏢 التحركات» في ملف الموظف بيعرض الوضع الحالي (مسجّل على / مركز التكلفة / شغال فعليًا في) والتحركات من الأحدث للأقدم. تبويب «السجل» فيه كل حاجة.
- **الترحيل `0007`:**
  - قبله نقل الموظف مكانش بيتسجل خالص. الترحيل حط سطر `baseline` لكل موظف بوضعه وقت الترقية.
  - صلّح السطور القديمة اللي كانت مكتوبة بالكود (`awaiting_contract` ← «بانتظار عقد العمل»).
  - مرحلة المعاملة والحالة الوظيفية بقوا بيتسجلوا بالاسم العربي.

