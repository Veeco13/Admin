# -*- coding: utf-8 -*-
"""
✋ الموافقة على التعديلات الحساسة (القسم 28)
المستخدم اللي مالوش صلاحية approvals.approve لما يغيّر حاجة من دول في موظف موجود، التغيير مابيتطبّقش على طول:
  - المرتب ومبلغ بدل السكن (salary)          - البنك والـ IBAN (bank)
  - إنهاء الخدمة: الحالة من / لـ (في فترة الإنذار، مستقيل، إنهاء خدمات) أو آخر يوم عمل ونوعه وسببه (service_end)
  - حذف الموظف (delete)
باقي التعديل بيتحفظ عادي، والحساس بيتحوّل لطلب (القديم والجديد) ← اللي معاه الصلاحية يوافق (بيتطبّق) أو يرفض بسبب.
مدير النظام واللي معاه الصلاحية تعديلاتهم بتتطبّق على طول.
"""
import json
from datetime import datetime, timedelta

from sqlalchemy import select

import db
import history
import models as M

PERM = "approvals.approve"
KINDS = {"salary": "المرتب وبدل السكن", "bank": "البنك والـ IBAN", "service_end": "إنهاء الخدمة", "delete": "حذف موظف"}
FIELDS = {"salary": ("salary", "housingAmount"), "bank": ("bank", "iban")}
SERVICE = ("employmentStatus", "serviceEndDate", "serviceEndType", "serviceEndReason")
END_STATES = ("warning", "resigned", "terminated")
LABELS = {"salary": "الراتب", "housingAmount": "مبلغ بدل السكن", "bank": "البنك", "iban": "IBAN", "employmentStatus": "الحالة الوظيفية",
          "serviceEndDate": "آخر يوم عمل", "serviceEndType": "نوع انتهاء الخدمة", "serviceEndReason": "سبب انتهاء الخدمة"}
STATUS = {"pending": "مستني موافقة", "approved": "اتوافق عليه", "rejected": "اترفض", "cancelled": "اتلغى"}


def _cols():
    return db._columns(M.Employee)


def _val(field, v):
    """القيمة بعد تحويل النوع (زي «540» = 540.0) بشكل نصي للمقارنة والحفظ."""
    x = db.ser(db.coerce(_cols()[field].columns[0].type, v))
    return None if x in (None, "") else x


def _cur(e, field):
    v = db.ser(getattr(e, field))
    if field == "employmentStatus":
        v = v or "active"
    return None if v in (None, "") else v


def _show(field, v):
    if v in (None, ""):
        return "—"
    if field in ("employmentStatus", "serviceEndType"):
        return history.EMP_STATUS_LABELS.get(v, v)
    if field in ("salary", "housingAmount"):
        try:
            return f"{float(v):,.3f}".rstrip("0").rstrip(".") + " د.ك"
        except (TypeError, ValueError):
            pass
    return str(history.value_label(field, v))


def describe(kind, changes):
    """«الراتب: 540 ← 600، البنك: …» للسجل والشاشة."""
    if kind == "delete":
        return KINDS["delete"]
    return "، ".join(f"{LABELS.get(f, f)}: {_show(f, o)} ← {_show(f, n)}" for f, (o, n) in changes.items())


def service_problem(new):
    """نفس قواعد تغيير الحالة الوظيفية ← رسالة أو None (عشان الطلب الغلط مايتبعتش أصلًا)."""
    st = new.get("employmentStatus") or "active"
    if st in END_STATES:
        if not new.get("serviceEndDate"):
            return "آخر يوم عمل مطلوب"
        end_type = st if st != "warning" else new.get("serviceEndType")
        if end_type not in ("resigned", "terminated"):
            return "اختار نوع انتهاء الخدمة (استقالة / إنهاء خدمات)"
    return None


def split(e, data):
    """التعديلات الحساسة في بيانات الحفظ اللي هتغيّر فعلًا ← بتتشال من data وبترجع ({النوع: {الخانة: [قديم، جديد]}}، رسالة خطأ)."""
    out = {}
    for kind, fields in FIELDS.items():
        for f in fields:
            if f not in data:
                continue
            old, new = _cur(e, f), _val(f, data[f])
            if old != new:
                out.setdefault(kind, {})[f] = [old, new]
            data.pop(f)
    svc = {f: data[f] for f in SERVICE if f in data}
    if svc:
        cur = {f: _cur(e, f) for f in SERVICE}
        new = dict(cur, **{f: (_val(f, v) if f != "employmentStatus" else (v or "active")) for f, v in svc.items()})
        diff = {f: [cur[f], new[f]] for f in SERVICE if cur[f] != new[f]}
        if diff and (cur["employmentStatus"] in END_STATES or new["employmentStatus"] in END_STATES
                     or any(f != "employmentStatus" for f in diff)):
            msg = service_problem(new)
            if msg:
                return {}, msg
            out["service_end"] = diff
            for f in SERVICE:
                data.pop(f, None)
    return out, None


def status_changes(e, status, end_date, end_type, reason):
    """طلب تغيير الحالة من شاشة الحالة الوظيفية ← ({الخانة: [قديم، جديد]}، رسالة)."""
    new = {"employmentStatus": status or "active", "serviceEndDate": db.ser(end_date),
           "serviceEndType": (status if status in ("resigned", "terminated") else end_type) if status in END_STATES else None,
           "serviceEndReason": ((reason or "").strip() or None) if status in END_STATES else None}
    if new["employmentStatus"] not in END_STATES:
        new["serviceEndDate"] = None
    msg = service_problem(new)
    if msg:
        return {}, msg
    cur = {f: _cur(e, f) for f in SERVICE}
    return {f: [cur[f], new[f]] for f in SERVICE if cur[f] != new[f]}, None


def request(s, e, kind, changes, u, source=None, note=None):
    """طلب جديد (والمستني من نفس النوع لنفس الموظف بيتلغي — الجديد مكانه) + سجل الموظف والتدقيق."""
    now = db.now()
    for r in s.scalars(select(M.ApprovalRequest).where(M.ApprovalRequest.employeeId == e.id, M.ApprovalRequest.kind == kind,
                                                       M.ApprovalRequest.status == "pending")):
        r.status, r.decidedBy, r.decidedAt, r.decisionNote = "cancelled", u.display, now, "اتبدّل بطلب أحدث"
    r = M.ApprovalRequest(id=db.new_id("apr"), employeeId=e.id, employeeName=e.name, kind=kind,
                          changes=json.dumps(changes, ensure_ascii=False), note=(note or "").strip() or None, source=source,
                          status="pending", requestedBy=u.display, requestedById=str(u.id), requestedAt=now)
    s.add(r)
    text = f"⏳ طلب موافقة — {KINDS[kind]}" + (f": {describe(kind, changes)}" if kind != "delete" else "") + (f" — {r.note}" if r.note else "")
    db.push_timeline(s, e.id, "edit", text, u.display)
    db.log_audit(s, "approval_request", f"{e.name} ({e.id}): {text}", u.display)
    return r


def hold(s, e, data, u, source):
    """للاستيراد: التعديلات الحساسة بتتشال من صف الملف وبتتحوّل لطلبات ← [وصف كل طلب]."""
    held, msg = split(e, data)
    if msg:                                          # حالة من غير آخر يوم عمل ← بتتشال بس من غير طلب
        for f in SERVICE:
            data.pop(f, None)
    out = []
    for k, ch in held.items():
        request(s, e, k, ch, u, source)
        out.append(f"{KINDS[k]}: {describe(k, ch)}")
    return out


def decide(s, r, approve, approver, note=None, set_status=None, delete=None):
    """موافقة (بيتطبّق) أو رفض ← رسالة خطأ أو None. القيمة لو اتغيّرت من وقت الطلب ← مايتطبّقش (يترفض ويتطلب تاني)."""
    if r.status != "pending":
        return "الطلب ده اتقرر قبل كده"
    e = s.get(M.Employee, r.employeeId)
    changes = json.loads(r.changes or "{}")
    if approve:
        if e is None:
            return "الموظف مش موجود"
        stale = [LABELS.get(f, f) for f, (old, _) in changes.items() if _cur(e, f) != old]
        if stale:
            return "القيمة اتغيّرت من وقت الطلب (" + "، ".join(stale) + ") — ارفضه واطلبه تاني"
        by = f"بموافقة {approver} على طلب {r.requestedBy}"
        if r.kind in FIELDS:
            db.apply(e, {f: new for f, (_, new) in changes.items()})
            e.lastUpdated, e.lastUpdatedBy = db.now(), approver
            db.push_timeline(s, e.id, "edit", f"{describe(r.kind, changes)} ({by})", approver)
        elif r.kind == "service_end":
            new = {f: (changes[f][1] if f in changes else _cur(e, f)) for f in SERVICE}
            msg = set_status(s, e, new["employmentStatus"] or "active", db.parse_date(new["serviceEndDate"]), new["serviceEndType"],
                             new["serviceEndReason"], r.note, approver, by)
            if msg:
                return msg
        elif r.kind == "delete":
            delete(s, e, approver)
    r.status = "approved" if approve else "rejected"
    r.decidedBy, r.decidedAt, r.decisionNote = approver, db.now(), (note or "").strip() or None
    text = f"{'✅ اتوافق على' if approve else '✖ اترفض'} طلب {KINDS[r.kind]}" + (f": {describe(r.kind, changes)}" if r.kind != "delete" else "") \
        + f" (طلب {r.requestedBy})" + (f" — السبب: {r.decisionNote}" if r.decisionNote else "")
    if e is not None and not (approve and r.kind == "delete"):
        db.push_timeline(s, e.id, "edit", text, approver)
    db.log_audit(s, "approval_decision", f"{r.employeeName} ({r.employeeId}): {text}", approver)
    return None


def to_api(r):
    ch = json.loads(r.changes or "{}")
    return {"id": r.id, "employeeId": r.employeeId, "employeeName": r.employeeName, "kind": r.kind, "kindLabel": KINDS.get(r.kind, r.kind),
            "changes": [{"field": f, "label": LABELS.get(f, f), "old": _show(f, o), "new": _show(f, n)} for f, (o, n) in ch.items()],
            "note": r.note, "source": r.source, "status": r.status, "requestedBy": r.requestedBy, "requestedById": r.requestedById,
            "requestedAt": db.ser(r.requestedAt), "decidedBy": r.decidedBy, "decidedAt": db.ser(r.decidedAt), "decisionNote": r.decisionNote}


def is_owner(r, u):
    return r.requestedById == str(u.id)


def visible(s, u, emp_ok):
    """اللي معاه الصلاحية: المستني كله (في نطاقه) + اللي اتقرر آخر 30 يوم. غيره: طلباته آخر 60 يوم."""
    since = datetime.now() - timedelta(days=60)
    q = select(M.ApprovalRequest).where((M.ApprovalRequest.status == "pending") | (M.ApprovalRequest.requestedAt >= since)) \
        .order_by(M.ApprovalRequest.requestedAt.desc())
    out = []
    for r in s.scalars(q):
        if u.can(PERM):
            if r.status != "pending" and r.decidedAt and r.decidedAt < datetime.now() - timedelta(days=30):
                continue
            if s.get(M.Employee, r.employeeId) is not None and not emp_ok(s, r.employeeId):
                continue
        elif not is_owner(r, u):
            continue
        out.append(to_api(r))
    return out
