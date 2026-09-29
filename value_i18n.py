# -*- coding: utf-8 -*-
"""
Lunx — ترجمة البيانات للتقارير الإنجليزية (الجنسيات والمهن).

الجنسية والمهنة بيتسجّلوا بالعربي (زي ما في الإقامة وإذن العمل)، فالتقرير الإنجليزي بياخد الترجمة من هنا:
- DEFAULTS: ترجمات جاهزة (الجنسية ← صفة الجنسية بالإنجليزي، والمهن اللي في البيانات).
- تعديلات المستخدم من «🌐 ترجمة الجنسيات والمهن» بتتخزّن في meta بمفتاح value_translations وبتغلب على الجاهز.
المطابقة في الواجهة بعد توحيد الهمزات والتاء المربوطة (norm)، فـ«الأردن» و«الاردن» واحد.
"""
import json

import db

KEY = "value_translations"
KINDS = ("nationality", "profession")

NATIONALITIES = {
    # الموجودة في البيانات
    "مصر": "Egyptian", "الهند": "Indian", "الكويت": "Kuwaiti", "نيبال": "Nepalese", "الجزائر": "Algerian",
    "بنغلاديش": "Bangladeshi", "باكستان": "Pakistani", "الفلبين": "Filipino", "كندا": "Canadian", "لبنان": "Lebanese",
    "الأردن": "Jordanian", "سوريا": "Syrian", "نيجيريا": "Nigerian", "ماليزيا": "Malaysian", "سيريلانكا": "Sri Lankan",
    "سريلانكا": "Sri Lankan", "سيرا ليون": "Sierra Leonean", "سيراليون": "Sierra Leonean", "غانا": "Ghanaian",
    "بوركينا فاسو": "Burkinabe", "مالي": "Malian", "اندونيسيا": "Indonesian", "المملكة المتحدة": "British",
    "بريطانيا": "British", "العراق": "Iraqi", "الصومال": "Somali", "معاملة كويتية": "Kuwaiti (treated as)",
    "كويتي": "Kuwaiti", "كويتية": "Kuwaiti", "فلسطين": "Palestinian", "جورجيا": "Georgian", "تونس": "Tunisian",
    "تشاد": "Chadian", "الولايات المتحدة الامريكية": "American", "الولايات المتحدة": "American", "أمريكا": "American",
    "النيجر": "Nigerien", "الكاميرون": "Cameroonian", "السودان": "Sudanese", "السعودية": "Saudi",
    "المملكة العربية السعودية": "Saudi", "إيران": "Iranian", "أوغندا": "Ugandan", "أثيوبيا": "Ethiopian",
    "إثيوبيا": "Ethiopian", "افغانستان": "Afghan",
    # جنسيات تانية شائعة
    "اليمن": "Yemeni", "عمان": "Omani", "سلطنة عمان": "Omani", "البحرين": "Bahraini", "قطر": "Qatari",
    "الإمارات": "Emirati", "الإمارات العربية المتحدة": "Emirati", "المغرب": "Moroccan", "ليبيا": "Libyan",
    "موريتانيا": "Mauritanian", "جيبوتي": "Djiboutian", "جزر القمر": "Comorian", "إريتريا": "Eritrean",
    "الصين": "Chinese", "تركيا": "Turkish", "كينيا": "Kenyan", "تنزانيا": "Tanzanian", "رواندا": "Rwandan",
    "بوروندي": "Burundian", "جنوب السودان": "South Sudanese", "السنغال": "Senegalese", "ساحل العاج": "Ivorian",
    "كوت ديفوار": "Ivorian", "غينيا": "Guinean", "بنين": "Beninese", "توغو": "Togolese", "ليبيريا": "Liberian",
    "غامبيا": "Gambian", "الكونغو": "Congolese", "زيمبابوي": "Zimbabwean", "زامبيا": "Zambian", "ملاوي": "Malawian",
    "مدغشقر": "Malagasy", "موريشيوس": "Mauritian", "جنوب أفريقيا": "South African", "فيتنام": "Vietnamese",
    "تايلاند": "Thai", "ميانمار": "Myanmar", "كمبوديا": "Cambodian", "سنغافورة": "Singaporean", "اليابان": "Japanese",
    "كوريا الجنوبية": "South Korean", "بوتان": "Bhutanese", "المالديف": "Maldivian", "أذربيجان": "Azerbaijani",
    "أرمينيا": "Armenian", "أوزبكستان": "Uzbek", "كازاخستان": "Kazakh", "طاجيكستان": "Tajik", "قيرغيزستان": "Kyrgyz",
    "تركمانستان": "Turkmen", "روسيا": "Russian", "أوكرانيا": "Ukrainian", "فرنسا": "French", "ألمانيا": "German",
    "إيطاليا": "Italian", "إسبانيا": "Spanish", "البرتغال": "Portuguese", "هولندا": "Dutch", "بلجيكا": "Belgian",
    "سويسرا": "Swiss", "النمسا": "Austrian", "السويد": "Swedish", "النرويج": "Norwegian", "الدنمارك": "Danish",
    "فنلندا": "Finnish", "أيرلندا": "Irish", "بولندا": "Polish", "رومانيا": "Romanian", "بلغاريا": "Bulgarian",
    "اليونان": "Greek", "قبرص": "Cypriot", "صربيا": "Serbian", "البوسنة والهرسك": "Bosnian", "ألبانيا": "Albanian",
    "أستراليا": "Australian", "نيوزيلندا": "New Zealander", "البرازيل": "Brazilian", "المكسيك": "Mexican",
    "الأرجنتين": "Argentine", "كولومبيا": "Colombian", "فنزويلا": "Venezuelan", "بيرو": "Peruvian", "تشيلي": "Chilean",
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

DEFAULTS = {"nationality": NATIONALITIES, "profession": PROFESSIONS}


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
