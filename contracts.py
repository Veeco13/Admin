# -*- coding: utf-8 -*-
"""
Lunx — العقود: تحويل PDF (عقد واحد أو كذا عقد في ملف واحد) + حقول إضافية للقوالب.
محرك القوالب نفسه (docx_engine.py) مُجمَّد — الملف ده بيستخدمه بس ومابيعدّلوش.

التحويل لـ PDF (أول واحد متاح):
- LibreOffice (soffice) ← في Docker ولينكس. كل عقود الدفعة بتتحول في استدعاء واحد.
- Microsoft Word عن طريق COM ← ويندوز (محتاج pywin32). Word بيفتح مرة واحدة لكل الدفعة.
"""
import io
import os
import pathlib
import re
import subprocess
import tempfile
import threading
import zipfile

import docx_engine

MAX_BATCH = int(os.environ.get("LUNX_CONTRACT_BATCH_MAX", "300"))
_lock = threading.Lock()          # تحويل واحد في المرة (Word و LibreOffice مابيحبوش التوازي)

# ---------------------------------------------------------------------------
# حقول إضافية للقوالب (العقد المرجعي فيه إدارة العمل بالإنجليزي)
# ---------------------------------------------------------------------------
GOVERNORATES_EN = {"الأحمدي": "Ahmadi", "الاحمدي": "Ahmadi", "مبارك الكبير": "Mubarak Al-Kabeer",
                   "الفروانية": "Farwaniya", "حولي": "Hawalli", "العاصمة": "Capital", "الجهراء": "Jahra"}
LABOR_OFFICE_EN = {"إدارة عمل العقود والمشاريع الحكومية": "Manpower - Government Contracts and Projects Labour Department"}


def labor_office_en(ar):
    """«إدارة عمل محافظة الأحمدي» ← «Manpower - Ahmadi Governorate Labour Department»."""
    ar = (ar or "").strip()
    if ar in LABOR_OFFICE_EN:
        return LABOR_OFFICE_EN[ar]
    for k, v in GOVERNORATES_EN.items():
        if k in ar:
            return f"Manpower - {v} Governorate Labour Department"
    return "Manpower"


# ترجمات تكميلية (قاموس المحرك المُجمَّد ناقص) — بتتستخدم بس لو المهنة/الجنسية بالإنجليزي فاضية
# والموظف مالوش قيمة مكتوبة في «المهنة (إنجليزي)» / «الجنسية (إنجليزي)».
PROFESSION_EN_EXTRA = {
    "مشرف حفريات": "Excavation Supervisor", "مشغل / معدات حفر آبار": "Operator / Well Drilling Equipment",
    "فني دعم المستخدمين": "User Support Technician", "عامل خلطة خرسانية": "Concrete Mixing Worker",
    "عامل مخازن": "Warehouse Worker", "مساعد ميكانيكي صيانة عامة": "General Maintenance Mechanic Assistant",
    "اختصاصي دعم فني": "Technical Support Specialist", "محاسب عام": "General Accountant",
    "سائق / دراجة نارية": "Driver / Motorcycle", "كيميائي عام": "General Chemist",
    "مهندس إدارة مشاريع": "Project Management Engineer", "فني ميكانيكي / آلات تشغيل": "Mechanical Technician / Operating Machines",
    "مهندس ميكانيكي / عام": "Mechanical Engineer / General", "مراقب إداري": "Administrative Controller",
    "كاتب إداري / عام": "Administrative Clerk / General", "نادل مقهى": "Cafe Waiter",
    "مهندس نفط وغاز": "Oil and Gas Engineer", "فني مختبر / نفط ومشتقات نفطية": "Laboratory Technician / Oil and Petroleum Products",
    "مدير عام": "General Manager", "مساعد فني/مختبر معادن": "Assistant Technician / Metals Laboratory",
    "مدير مشروعات": "Projects Manager", "مدير صيانة": "Maintenance Manager", "مستشار قانوني": "Legal Consultant",
    "حفار آبار / نفط وغاز": "Well Driller / Oil and Gas", "مدير إداري": "Administrative Manager",
    "مساعد ميكانيكي آلات ثقيلة": "Heavy Machinery Mechanic Assistant", "مهندس كهربائي / عام": "Electrical Engineer / General",
    "مهندس كيميائي / عام": "Chemical Engineer / General", "مراسل": "Messenger", "سكرتير اداري": "Administrative Secretary",
    "مخلص معاملات": "Transactions Clearance Officer", "اختصاصي مبيعات": "Sales Specialist",
    "مشرف شؤون موظفين": "Personnel Affairs Supervisor",
    "ميكانيكي / صيانة ميكانيكية عامة - عام": "Mechanic / General Mechanical Maintenance - General",
    "لحام أنابيب": "Pipe Welder", "مدير عمليات تشغيل": "Operations Manager",
    "مهندس مدني/ فحص واختبار مواد": "Civil Engineer / Materials Inspection and Testing", "مهندس مشروع": "Project Engineer",
    "فنى مختبر": "Laboratory Technician", "فني مختبر": "Laboratory Technician",
    "مهندس إلكتروني / حاسوب": "Electronics Engineer / Computer", "اختصاصي موارد بشرية": "Human Resources Specialist",
    "فني مختبرات/ كيمياء حيوية": "Laboratory Technician / Biochemistry", "كاتب تدقيق بيانات": "Data Audit Clerk",
    "اختصاصي خدمات التقنية": "Technical Services Specialist", "ميكانيكي صيانة ميكانيكية عامة": "General Mechanical Maintenance Mechanic",
    "مدير مالي": "Financial Manager", "فني برمجة": "Programming Technician", "مهندس معماري": "Architect",
    "اختصاصي شؤون إدارية": "Administrative Affairs Specialist", "مدير موارد بشرية": "Human Resources Manager",
    "راعي": "Shepherd", "كاتب وارد وصادر": "Incoming and Outgoing Mail Clerk", "عامل تنظيف / مكاتب": "Cleaner / Offices",
    "فني مختبر مواد إنشائية": "Construction Materials Laboratory Technician",
    "فني (مراقب) جودة شاملة": "Total Quality (Control) Technician", "الكتروني شبكات حاسوبية": "Computer Networks Electronics Technician",
    "مهندس كيميائي / بتروكيماويات": "Chemical Engineer / Petrochemicals", "فني كهربائي / عام": "Electrical Technician / General",
    "مهندس ميكانيك": "Mechanical Engineer", "سائق / حافلة": "Driver / Bus", "سكرتير تنفيذي": "Executive Secretary",
    "عامل مزرعة": "Farm Worker", "حارس أمن": "Security Guard", "مهندس كهربائي / صيانة": "Electrical Engineer / Maintenance",
    "مستشار مالي": "Financial Consultant", "اختصاصي نظم معلومات محاسبية": "Accounting Information Systems Specialist",
    "محاسب تكاليف": "Cost Accountant", "اختصاصي توظيف": "Recruitment Specialist", "مشرف مدخلي البيانات": "Data Entry Supervisor",
    "مندوب مشتريات": "Purchasing Representative", "مفتش سلامة مهنية/ عام": "Occupational Safety Inspector / General",
    "مدير تجاري": "Commercial Manager", "مشرف مخازن": "Warehouse Supervisor",
    "مساعد كهربائي / آلات ومفاتيح": "Electrician Assistant / Machines and Switches", "سائق سيارة خصوصي": "Driver / Private Car",
}
NATIONALITY_EN_EXTRA = {
    "سيرا ليون": "Sierra Leone", "سيريلانكا": "Sri Lanka", "بوركينا فاسو": "Burkina Faso", "اندونيسيا": "Indonesia",
    "الصومال": "Somalia", "المملكة المتحدة": "United Kingdom", "أثيوبيا": "Ethiopia", "تشاد": "Chad", "أوغندا": "Uganda",
    "الكاميرون": "Cameroon", "معاملة كويتية": "Treated as Kuwaiti", "الولايات المتحدة الامريكية": "United States",
    "النيجر": "Niger", "جورجيا": "Georgia",
}


def extra_context(ctx):
    ctx.setdefault("labor_office_en", labor_office_en(ctx.get("labor_office")))
    if not ctx.get("profession_en"):
        ctx["profession_en"] = PROFESSION_EN_EXTRA.get((ctx.get("profession") or "").strip(), "")
    if not ctx.get("nationality_en"):
        ctx["nationality_en"] = NATIONALITY_EN_EXTRA.get((ctx.get("nationality") or "").strip(), "")
    return ctx


# البند الثالث عشر (شروط خاصة) — بند بدل السكن اختياري. من غيره البند بيتكتب «لايوجد» زي البندين 2 و3.
HOUSING_CLAUSE_AR = "يتضمن الأجر الشهري المنصوص عليه في البند الرابع من هذا العقد بدل سكن."
HOUSING_CLAUSE_EN = "The monthly remuneration provided for in Clause Four of this contract includes a housing allowance."


def housing_included(choice, emp):
    """choice: 1 = يُضاف (الافتراضي)، 0 = لا يُضاف، auto = حسب «بدل السكن مشمول» في بيانات الموظف."""
    choice = str(choice if choice not in (None, "") else "1")
    return bool((emp or {}).get("housingIncluded")) if choice == "auto" else choice != "0"


def housing_context(ctx, include):
    ctx["housing_clause"] = HOUSING_CLAUSE_AR if include else "لايوجد"
    ctx["housing_clause_en"] = HOUSING_CLAUSE_EN if include else "NONE"
    return ctx


# ---------------------------------------------------------------------------
# التوقيعات: القالب فيه {{sig_first_party}} و{{sig_second_party}} في جدول التوقيع.
# المحرك بيحط مكانهم علامة نصية، وبعدين apply_signatures بتحط الصورة مكان العلامة (أو تشيلها).
# ---------------------------------------------------------------------------
SIG_MARKS = {"first": "[[LUNX_SIG_FIRST]]", "second": "[[LUNX_SIG_SECOND]]"}
SIG_HEIGHT_CM, SIG_MAX_WIDTH_CM = 1.4, 5.0
SIG_MAX_BYTES = 3 * 1024 * 1024


def signature_context(ctx):
    ctx["sig_first_party"] = SIG_MARKS["first"]
    ctx["sig_second_party"] = SIG_MARKS["second"]
    return ctx


def check_signature_image(data):
    """صورة التوقيع: PNG أو JPG، أقل من 3MB. بيرجّع رسالة خطأ أو None."""
    from docx.image.image import Image as DocxImage
    if len(data) > SIG_MAX_BYTES:
        return "حجم صورة التوقيع لازم يكون أقل من 3MB"
    if not (data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff"):
        return "صورة التوقيع لازم تكون PNG أو JPG"
    try:
        img = DocxImage.from_blob(data)
        if not img.px_width or not img.px_height:
            raise ValueError
    except Exception:
        return "ملف الصورة تالف"
    return None


def apply_signatures(docx_bytes, images):
    """images = {"first": مسار صورة أو None، "second": …}. بيحط الصورة مكان العلامة أو يشيل العلامة.
    بعد صورة الطرف الأول بيشيل سطرين فاضيين من نفس الخانة عشان العقد مايزيدش صفحة."""
    from docx import Document
    from docx.image.image import Image as DocxImage
    from docx.shared import Cm
    doc = Document(io.BytesIO(docx_bytes))
    changed = False
    for p in docx_engine._iter_paragraphs(doc):
        for run in p.runs:
            for kind, mark in SIG_MARKS.items():
                if mark not in run.text:
                    continue
                run.text = run.text.replace(mark, "")
                changed = True
                path = images.get(kind)
                if not path:
                    continue
                img = DocxImage.from_file(path)
                w = SIG_HEIGHT_CM * img.px_width / img.px_height
                run.add_picture(path, width=Cm(min(w, SIG_MAX_WIDTH_CM)))
                nxt, removed = p._p.getnext(), 0
                while nxt is not None and removed < 2 and nxt.tag.endswith("}p") and not "".join(nxt.itertext()).strip() \
                        and not list(nxt.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing")):
                    following = nxt.getnext()
                    nxt.getparent().remove(nxt)
                    nxt, removed = following, removed + 1
    if not changed:
        return docx_bytes
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# الحقول اللي لو فاضية العقد يطلع ناقص (الاسم المعروض للمستخدم)
REQUIRED_FIELDS = [
    ("employee_name_en", "الاسم بالإنجليزي"), ("nationality_en", "الجنسية بالإنجليزي"), ("profession", "المهنة"),
    ("profession_en", "المهنة بالإنجليزي"), ("salary", "الراتب"), ("start_date", "تاريخ العقد"),
    ("company_name", "الشركة"), ("company_name_en", "اسم الشركة بالإنجليزي"), ("auth_name", "المفوّض بالتوقيع"),
    ("auth_civil_id", "الرقم المدني للمفوّض"), ("labor_office", "إدارة العمل"),
]


def missing_fields(ctx):
    return [label for key, label in REQUIRED_FIELDS if not str(ctx.get(key) or "").strip()]


# اسم كل حقل للمستخدم (للنواقص). الحقول المشتقة بتاخد اسم أصلها (اليوم ← تاريخ العقد)
FIELD_LABELS = {
    "employee_name": "الاسم", "employee_name_en": "الاسم بالإنجليزي", "civil_id": "الرقم المدني",
    "nationality": "الجنسية", "nationality_en": "الجنسية بالإنجليزي", "profession": "المهنة",
    "profession_en": "المهنة بالإنجليزي", "salary": "الراتب", "housing_amount": "مبلغ بدل السكن",
    "start_date": "تاريخ العقد", "day_name": "تاريخ العقد", "day_name_en": "تاريخ العقد", "passport_no": "رقم الجواز",
    "residency_exp": "انتهاء الإقامة", "file_number": "رقم الملف", "company_name": "الشركة",
    "company_name_en": "اسم الشركة بالإنجليزي", "labor_office": "إدارة العمل", "labor_office_en": "إدارة العمل",
    "project_name": "المشروع", "auth_name": "المفوّض بالتوقيع", "auth_name_en": "اسم المفوّض بالإنجليزي",
    "auth_civil_id": "الرقم المدني للمفوّض",
}
_TEMPLATE_FIELDS = {}


def template_fields(path):
    """الحقول {{ … }} اللي القالب بيستخدمها فعلًا (النص والهيدر والفوتر)."""
    key = (path, os.path.getmtime(path))
    if key not in _TEMPLATE_FIELDS:
        with zipfile.ZipFile(path) as z:
            text = "".join(re.sub(r"<[^>]+>", "", z.read(n).decode("utf-8")) for n in z.namelist()
                           if re.fullmatch(r"word/(document|header\d*|footer\d*)\.xml", n))
        _TEMPLATE_FIELDS[key] = set(re.findall(r"\{\{\s*(\w+)\s*\}\}", text))
    return _TEMPLATE_FIELDS[key]


def missing_in_template(ctx, fields):
    """الحقول الأساسية الفاضية + أي حقل تاني القالب بيستخدمه وفاضي (من غير تكرار)."""
    out = missing_fields(ctx)
    for key, label in FIELD_LABELS.items():
        if key in fields and not str(ctx.get(key) or "").strip() and label not in out:
            out.append(label)
    return out


# ---------------------------------------------------------------------------
# محرك التحويل
# ---------------------------------------------------------------------------
def _soffice():
    exe = docx_engine.soffice_path()
    if exe:
        return exe
    for p in (r"C:\Program Files\LibreOffice\program\soffice.exe", r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"):
        if os.path.exists(p):
            return p
    return None


def _word_installed():
    if os.name != "nt":
        return False
    try:
        import importlib.util
        import winreg
        if not importlib.util.find_spec("win32com"):
            return False
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                       r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Winword.exe"))
        return True
    except Exception:
        return False


def backend():
    """libreoffice | word | None"""
    if _soffice():
        return "libreoffice"
    if _word_installed():
        return "word"
    return None


def _convert_libreoffice(srcs, outdir):
    # بروفايل منفصل لكل بروسيس ← كذا worker (gunicorn) يقدروا يحوّلوا من غير ما يقفلوا على بعض
    profile = pathlib.Path(tempfile.gettempdir(), f"lunx-lo-{os.getpid()}").as_uri()
    subprocess.run([_soffice(), f"-env:UserInstallation={profile}", "--headless", "--convert-to", "pdf",
                    "--outdir", outdir, *srcs],
                   check=True, timeout=60 + 5 * len(srcs), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _convert_word(srcs):
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    word = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        for src in srcs:
            doc = word.Documents.Open(os.path.abspath(src), False, True, False)   # ConfirmConversions, ReadOnly, AddToRecent
            try:
                doc.ExportAsFixedFormat(os.path.abspath(src[:-5] + ".pdf"), 17)    # 17 = wdExportFormatPDF
            finally:
                doc.Close(0)
    finally:
        if word is not None:
            try:
                word.Quit(0)
            except Exception:
                pass
        pythoncom.CoUninitialize()


def to_pdfs(docs):
    """[ملف Word bytes] ← [PDF bytes] بنفس الترتيب. بيرمي RuntimeError لو مفيش محرك أو التحويل فشل."""
    engine = backend()
    if not engine:
        raise RuntimeError("تحويل PDF محتاج LibreOffice أو Microsoft Word على السيرفر")
    with _lock, tempfile.TemporaryDirectory() as d:
        srcs = []
        for i, data in enumerate(docs):
            p = os.path.join(d, f"c{i:04d}.docx")
            with open(p, "wb") as f:
                f.write(data)
            srcs.append(p)
        try:
            if engine == "libreoffice":
                _convert_libreoffice(srcs, d)
            else:
                _convert_word(srcs)
            out = []
            for p in srcs:
                with open(p[:-5] + ".pdf", "rb") as f:
                    out.append(f.read())
            return out
        except Exception as e:
            raise RuntimeError(f"فشل تحويل العقود لـ PDF ({engine}): {e}") from e


def to_pdf(data):
    return to_pdfs([data])[0]


def merge_pdfs(pdfs):
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    for b in pdfs:
        w.append(PdfReader(io.BytesIO(b)))
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def zip_docs(named_docs):
    """[(اسم الملف، bytes)] ← ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        seen = set()
        for name, data in named_docs:
            base, n = name, 2
            while name in seen:
                name = f"{base[:-5]} ({n}).docx"
                n += 1
            seen.add(name)
            z.writestr(name, data)
    return buf.getvalue()
