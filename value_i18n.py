# -*- coding: utf-8 -*-
"""
Lunx — ترجمة البيانات للتقارير الإنجليزية (الجنسيات والمهن).

الجنسية والمهنة بيتسجّلوا بالعربي (زي ما في الإقامة وإذن العمل)، فالتقرير الإنجليزي بياخد الترجمة من هنا:
- DEFAULTS: ترجمات جاهزة (الجنسية ← اسم الدولة زي البطاقة المدنية، والمهن اللي في البيانات) + قواميس عقد العمل.
- خانتي «الجنسية (إنجليزي)» و«المهنة (إنجليزي)» في بطاقة الموظف بيغلبوا على القاموس (في التقرير والعقد).
- تعديلات المستخدم من «🌐 ترجمة الجنسيات والمهن» بتتخزّن في meta بمفتاح value_translations وبتغلب على الجاهز.
المطابقة في الواجهة بعد توحيد الهمزات والتاء المربوطة (norm)، فـ«الأردن» و«الاردن» واحد.
"""
import json
import re

import contracts
import db
import docx_engine

KEY = "value_translations"
KINDS = ("nationality", "profession")

# الجنسية بالإنجليزي = اسم الدولة، زي البطاقة المدنية والإقامة وعقد العمل (docx_engine.NATIONALITY_EN)
NATIONALITIES = {
    # الموجودة في البيانات
    "مصر": "Egypt", "الهند": "India", "الكويت": "Kuwait", "نيبال": "Nepal", "الجزائر": "Algeria",
    "بنغلاديش": "Bangladesh", "باكستان": "Pakistan", "الفلبين": "Philippines", "كندا": "Canada", "لبنان": "Lebanon",
    "الأردن": "Jordan", "سوريا": "Syria", "نيجيريا": "Nigeria", "ماليزيا": "Malaysia", "سيريلانكا": "Sri Lanka",
    "سريلانكا": "Sri Lanka", "سيرا ليون": "Sierra Leone", "سيراليون": "Sierra Leone", "غانا": "Ghana",
    "بوركينا فاسو": "Burkina Faso", "مالي": "Mali", "اندونيسيا": "Indonesia", "المملكة المتحدة": "United Kingdom",
    "بريطانيا": "United Kingdom", "العراق": "Iraq", "الصومال": "Somalia", "معاملة كويتية": "Treated as Kuwaiti",
    "كويتي": "Kuwait", "كويتية": "Kuwait", "فلسطين": "Palestine", "جورجيا": "Georgia", "تونس": "Tunisia",
    "تشاد": "Chad", "الولايات المتحدة الامريكية": "United States", "الولايات المتحدة": "United States", "أمريكا": "United States",
    "النيجر": "Niger", "الكاميرون": "Cameroon", "السودان": "Sudan", "السعودية": "Saudi Arabia",
    "المملكة العربية السعودية": "Saudi Arabia", "إيران": "Iran", "أوغندا": "Uganda", "أثيوبيا": "Ethiopia",
    "إثيوبيا": "Ethiopia", "افغانستان": "Afghanistan",
    # دول تانية شائعة
    "اليمن": "Yemen", "عمان": "Oman", "سلطنة عمان": "Oman", "البحرين": "Bahrain", "قطر": "Qatar",
    "الإمارات": "United Arab Emirates", "الإمارات العربية المتحدة": "United Arab Emirates", "المغرب": "Morocco",
    "ليبيا": "Libya", "موريتانيا": "Mauritania", "جيبوتي": "Djibouti", "جزر القمر": "Comoros", "إريتريا": "Eritrea",
    "الصين": "China", "تركيا": "Turkey", "كينيا": "Kenya", "تنزانيا": "Tanzania", "رواندا": "Rwanda", "بوروندي": "Burundi",
    "جنوب السودان": "South Sudan", "السنغال": "Senegal", "ساحل العاج": "Ivory Coast", "كوت ديفوار": "Ivory Coast",
    "غينيا": "Guinea", "بنين": "Benin", "توغو": "Togo", "ليبيريا": "Liberia", "غامبيا": "Gambia", "الكونغو": "Congo",
    "زيمبابوي": "Zimbabwe", "زامبيا": "Zambia", "ملاوي": "Malawi", "مدغشقر": "Madagascar", "موريشيوس": "Mauritius",
    "جنوب أفريقيا": "South Africa", "فيتنام": "Vietnam", "تايلاند": "Thailand", "ميانمار": "Myanmar",
    "كمبوديا": "Cambodia", "سنغافورة": "Singapore", "اليابان": "Japan", "كوريا الجنوبية": "South Korea", "بوتان": "Bhutan",
    "المالديف": "Maldives", "أذربيجان": "Azerbaijan", "أرمينيا": "Armenia", "أوزبكستان": "Uzbekistan",
    "كازاخستان": "Kazakhstan", "طاجيكستان": "Tajikistan", "قيرغيزستان": "Kyrgyzstan", "تركمانستان": "Turkmenistan",
    "روسيا": "Russia", "أوكرانيا": "Ukraine", "فرنسا": "France", "ألمانيا": "Germany", "إيطاليا": "Italy",
    "إسبانيا": "Spain", "البرتغال": "Portugal", "هولندا": "Netherlands", "بلجيكا": "Belgium", "سويسرا": "Switzerland",
    "النمسا": "Austria", "السويد": "Sweden", "النرويج": "Norway", "الدنمارك": "Denmark", "فنلندا": "Finland",
    "أيرلندا": "Ireland", "بولندا": "Poland", "رومانيا": "Romania", "بلغاريا": "Bulgaria", "اليونان": "Greece",
    "قبرص": "Cyprus", "صربيا": "Serbia", "البوسنة والهرسك": "Bosnia and Herzegovina", "ألبانيا": "Albania",
    "أستراليا": "Australia", "نيوزيلندا": "New Zealand", "البرازيل": "Brazil", "المكسيك": "Mexico",
    "الأرجنتين": "Argentina", "كولومبيا": "Colombia", "فنزويلا": "Venezuela", "بيرو": "Peru", "تشيلي": "Chile",
    "بدون": "Stateless (Bedoon)", "غير محدد الجنسية": "Stateless",
}

PROFESSIONS = {
    "اختصاصي توظيف": "Recruitment Specialist",
    "اختصاصي خدمات التقنية": "IT Services Specialist",
    "اختصاصي دعم فني": "Technical Support Specialist",
    "اختصاصي شؤون إدارية": "Administrative Affairs Specialist",
    "اختصاصي مبيعات": "Sales Specialist",
    "اختصاصي موارد بشرية": "Human Resources Specialist",
    "اختصاصي نظم معلومات محاسبية": "Accounting Information Systems Specialist",
    "الكتروني شبكات حاسوبية": "Computer Networks Electronics Technician",
    "حارس أمن": "Security Guard",
    "حفار آبار / نفط وغاز": "Well Driller / Oil & Gas",
    "راعي": "Shepherd",
    "سائق / حافلة": "Driver / Bus",
    "سائق / دراجة نارية": "Driver / Motorcycle",
    "سائق / سيارة خصوصي": "Driver / Private Car",
    "سائق / شاحنة": "Driver / Truck",
    "سائق / مشغل حفار": "Driver / Excavator Operator",
    "سائق سيارة خصوصي": "Private Car Driver",
    "سكرتير": "Secretary",
    "سكرتير اداري": "Administrative Secretary",
    "سكرتير تنفيذي": "Executive Secretary",
    "عامل تنظيف / مكاتب": "Cleaner / Offices",
    "عامل خلطة خرسانية": "Concrete Mixing Worker",
    "عامل زراعي / تجهيز بيئات محمية": "Agricultural Worker / Greenhouse Preparation",
    "عامل زراعي / قطف محاصيل": "Agricultural Worker / Crop Harvesting",
    "عامل مخازن": "Warehouse Worker",
    "عامل مزرعة": "Farm Worker",
    "فنى مختبر": "Laboratory Technician",
    "فني مختبر": "Laboratory Technician",
    "فني (مراقب) جودة شاملة": "Total Quality Technician (Inspector)",
    "فني برمجة": "Programming Technician",
    "فني دعم المستخدمين": "User Support Technician",
    "فني كهربائي / عام": "Electrical Technician / General",
    "فني مختبر / نفط ومشتقات نفطية": "Laboratory Technician / Oil & Petroleum Products",
    "فني مختبر مواد إنشائية": "Construction Materials Laboratory Technician",
    "فني مختبرات/ كيمياء حيوية": "Laboratory Technician / Biochemistry",
    "فني ميكانيكي / آلات تشغيل": "Mechanical Technician / Operating Machinery",
    "كاتب إداري / عام": "Administrative Clerk / General",
    "كاتب تدقيق بيانات": "Data Audit Clerk",
    "كاتب وارد وصادر": "Incoming & Outgoing Mail Clerk",
    "كيميائي عام": "General Chemist",
    "لحام أنابيب": "Pipe Welder",
    "مبرمج حاسب آلي": "Computer Programmer",
    "محاسب تكاليف": "Cost Accountant",
    "محاسب عام": "General Accountant",
    "مخلص معاملات": "Government Transactions Clerk",
    "مدير إداري": "Administrative Manager",
    "مدير تجاري": "Commercial Manager",
    "مدير صيانة": "Maintenance Manager",
    "مدير عام": "General Manager",
    "مدير عمليات تشغيل": "Operations Manager",
    "مدير مالي": "Finance Manager",
    "مدير مشتريات": "Purchasing Manager",
    "مدير مشروعات": "Projects Manager",
    "مدير موارد بشرية": "Human Resources Manager",
    "مراسل": "Messenger",
    "مراقب إداري": "Administrative Supervisor",
    "مراقب مالي": "Financial Controller",
    "مساعد فني/مختبر معادن": "Assistant Technician / Metals Laboratory",
    "مساعد كهربائي / آلات ومفاتيح": "Assistant Electrician / Machines & Switches",
    "مساعد ميكانيكي آلات ثقيلة": "Heavy Machinery Assistant Mechanic",
    "مساعد ميكانيكي صيانة عامة": "General Maintenance Assistant Mechanic",
    "مستشار قانوني": "Legal Advisor",
    "مستشار مالي": "Financial Advisor",
    "مشرف حفريات": "Excavation Supervisor",
    "مشرف شؤون موظفين": "Personnel Affairs Supervisor",
    "مشرف مخازن": "Warehouse Supervisor",
    "مشرف مدخلي البيانات": "Data Entry Supervisor",
    "مشغل / معدات حفر آبار": "Operator / Well Drilling Equipment",
    "مفتش سلامة مهنية/ عام": "Occupational Safety Inspector / General",
    "مندوب مشتريات": "Purchasing Representative",
    "مهندس إدارة مشاريع": "Project Management Engineer",
    "مهندس إلكتروني / حاسوب": "Electronics Engineer / Computer",
    "مهندس كهربائي / صيانة": "Electrical Engineer / Maintenance",
    "مهندس كهربائي / عام": "Electrical Engineer / General",
    "مهندس كيميائي / بتروكيماويات": "Chemical Engineer / Petrochemicals",
    "مهندس كيميائي / عام": "Chemical Engineer / General",
    "مهندس مدني/ فحص واختبار مواد": "Civil Engineer / Materials Inspection & Testing",
    "مهندس مشروع": "Project Engineer",
    "مهندس معماري": "Architect",
    "مهندس ميكانيك": "Mechanical Engineer",
    "مهندس ميكانيكي / عام": "Mechanical Engineer / General",
    "مهندس نفط وغاز": "Oil & Gas Engineer",
    "ميكانيكي / صيانة ميكانيكية عامة - عام": "Mechanic / General Mechanical Maintenance",
    "ميكانيكي صيانة ميكانيكية عامة": "General Mechanical Maintenance Mechanic",
    "نادل مقهى": "Café Waiter",
}

# قواميس عقد العمل بتغلب على اللي هنا، علشان العقد والتقرير يكتبوا نفس الترجمة
DEFAULTS = {
    "nationality": {**NATIONALITIES, **docx_engine.NATIONALITY_EN, **contracts.NATIONALITY_EN_EXTRA},
    "profession": {**PROFESSIONS, **docx_engine.PROFESSION_EN, **contracts.PROFESSION_EN_EXTRA},
}


def norm(v):
    """نفس norm في الواجهة: الهمزات والتاء المربوطة والألف المقصورة والتشكيل."""
    v = re.sub(r"[أإآ]", "ا", str(v or "").lower())
    return re.sub(r"[ً-ْ]", "", v.replace("ة", "ه").replace("ى", "ي")).strip()


def lookup(tr, kind, value):
    """الترجمة الإنجليزية لقيمة من قاموس merged() (بعد توحيد الكتابة) أو None."""
    if not value:
        return None
    d = tr.get(kind) or {}
    if value in d:
        return d[value] or None
    n = norm(value)
    return next((en for ar, en in d.items() if en and norm(ar) == n), None)


def overrides(s):
    try:
        d = json.loads(db.get_meta(s, KEY) or "{}")
    except ValueError:
        d = {}
    return {k: {a: e for a, e in (d.get(k) or {}).items() if isinstance(a, str) and isinstance(e, str)} for k in KINDS}


def merged(s):
    """للواجهة: الجاهز + تعديلات المستخدم (بتغلب)."""
    o = overrides(s)
    return {k: {**DEFAULTS[k], **o[k]} for k in KINDS}


def save(s, data):
    """data = {kind: {عربي: إنجليزي}} ← بيتخزّن اللي مختلف عن الجاهز بس (فاضي = يرجع للجاهز). بيرجّع عدد التعديلات."""
    o = overrides(s)
    n = 0
    for k in KINDS:
        for ar, en in (data.get(k) or {}).items():
            ar, en = str(ar or "").strip(), str(en or "").strip()
            if not ar:
                continue
            if not en or en == DEFAULTS[k].get(ar):
                n += o[k].pop(ar, None) is not None
            elif o[k].get(ar) != en:
                o[k][ar] = en
                n += 1
    db.set_meta(s, KEY, json.dumps(o, ensure_ascii=False))
    return n
