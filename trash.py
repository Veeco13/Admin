# -*- coding: utf-8 -*-
"""
🗑️ سلة المحذوفات (القسم 28)
- حذف الموظف / المترشّح / العربية / التصريح بيحط نسخة كاملة منه ومن المرتبط بيه في جدول trash بدل ما يختفي:
  الموظف ← انتماءاته وتصاريحه (وأماكنها)، ومين كان مربوط بيه (العربيات اللي «مع مين» عليه، وخطاباته)؛ العربية ←
  تصاريحها. ملفات التصاريح بتتنقل لـ trash/<id>/ بدل ما تتمسح.
- «♻️ استرجاع» بيرجّع كله زي ما كان (ولو اتسجّل حد بنفس الرقم المدني / اللوحة من وقتها ← الاسترجاع بيتقفل برسالة).
- الحذف النهائي لمدير النظام بس، وبعد KEEP_DAYS يوم بيتحذف نهائي لوحده.
"""
import json
import os
import shutil
from datetime import datetime, timedelta

from sqlalchemy import select

import db
import models as M

KINDS = {"employee": ("موظف", "employees.delete"), "candidate": ("مترشّح", "recruitment.delete"),
         "vehicle": ("سيارة", "vehicles.delete"), "permit": ("تصريح", "permits.delete")}
KEEP_DAYS = 90
TABLES = {m.__tablename__: m for m in M.ALL_MODELS}


def _rows(s, model, cond):
    return [{k: db.ser(v) for k, v in r.items()} for r in s.execute(select(model.__table__).where(cond)).mappings()]


def _insert(s, table, rows):
    t = TABLES[table].__table__
    cols = {c.name: c for c in t.columns}
    for r in rows:
        s.execute(t.insert().values({k: db.coerce(cols[k].type, v) for k, v in r.items() if k in cols}))


def _move(src_rel, dst_rel):
    src, dst = db.resolve_file(src_rel), db.resolve_file(dst_rel)
    if not os.path.exists(src):
        return False
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(src, dst)
    return True


def _new(kind, record_id, label, company_ids, user):
    return M.Trash(id=db.new_id("tr"), kind=kind, recordId=record_id, label=label,
                   companyIds=json.dumps(sorted({c for c in company_ids if c})), deletedBy=user, deletedAt=db.now())


def _take_permits(s, t, cond, files):
    """التصاريح (والأماكن) ← صفوف للسلة، والمرفقات بتتنقل لـ trash/<id>/، والتصاريح بتتمسح من الجداول."""
    permits = list(s.scalars(select(M.Permit).where(cond)))
    ids = [p.id for p in permits]
    rows = _rows(s, M.Permit, cond)
    links = _rows(s, M.PermitPlaceLink, M.PermitPlaceLink.permitId.in_(ids)) if ids else []
    for p in permits:
        if p.filePath:
            dst = f"trash/{t.id}/{os.path.basename(p.filePath)}"
            if _move(p.filePath, dst):
                files.append({"from": p.filePath, "to": dst})
    if ids:
        s.query(M.PermitPlaceLink).filter(M.PermitPlaceLink.permitId.in_(ids)).delete(synchronize_session=False)
        s.query(M.Permit).filter(M.Permit.id.in_(ids)).delete(synchronize_session=False)
    return rows, links


def _save(s, t, rows, relink, files, summary):
    t.data = json.dumps({"rows": rows, "relink": relink, "files": files, "summary": summary}, ensure_ascii=False)
    s.add(t)
    return t


# ---------------------------------------------------------------------------
# الحذف ← السلة
# ---------------------------------------------------------------------------
def trash_employee(s, e, user):
    eid = e.id
    affs = _rows(s, M.EmployeeAffiliation, M.EmployeeAffiliation.employeeId == eid)
    t = _new("employee", eid, f"{e.name} ({eid})", [a["company_id"] for a in affs], user)
    files = []
    rows = {"employees": _rows(s, M.Employee, M.Employee.id == eid), "employee_affiliations": affs}
    rows["permits"], rows["permit_place_links"] = _take_permits(s, t, M.Permit.employeeId == eid, files)
    relink = {"vehicles.driver_id": [v.id for v in s.scalars(select(M.Vehicle).where(M.Vehicle.driverId == eid))],
              "hr_letters.employee_id": [x.id for x in s.scalars(select(M.HrLetter).where(M.HrLetter.employeeId == eid))]}
    s.query(M.EmployeeAffiliation).filter(M.EmployeeAffiliation.employeeId == eid).delete()
    s.query(M.Vehicle).filter(M.Vehicle.driverId == eid).update({"driverId": None})
    s.query(M.HrLetter).filter(M.HrLetter.employeeId == eid).update({"employeeId": None})   # الخطابات بتفضل في السجل
    s.flush()
    s.delete(e)
    return _save(s, t, rows, relink, files, {"permits": len(rows["permits"]), "vehicles": len(relink["vehicles.driver_id"]),
                                               "letters": len(relink["hr_letters.employee_id"])})


def trash_vehicle(s, v, user):
    t = _new("vehicle", v.id, v.plate, [v.companyId], user)
    files = []
    rows = {"vehicles": _rows(s, M.Vehicle, M.Vehicle.id == v.id)}
    rows["permits"], rows["permit_place_links"] = _take_permits(s, t, M.Permit.vehicleId == v.id, files)
    s.flush()
    s.delete(v)
    return _save(s, t, rows, {}, files, {"permits": len(rows["permits"])})


def trash_candidate(s, c, user):
    t = _new("candidate", c.id, c.name, [c.targetCompanyId], user)
    rows = {"candidates": _rows(s, M.Candidate, M.Candidate.id == c.id)}
    s.delete(c)
    return _save(s, t, rows, {}, [], {})


def trash_permit(s, p, label, company_id, user):
    t = _new("permit", p.id, label, [company_id], user)
    files = []
    rows = {}
    rows["permits"], rows["permit_place_links"] = _take_permits(s, t, M.Permit.id == p.id, files)
    return _save(s, t, rows, {}, files, {})


# ---------------------------------------------------------------------------
# الاسترجاع والحذف النهائي
# ---------------------------------------------------------------------------
def _conflict(s, t, rows):
    """الاسترجاع مايتعملش لو اتسجّل حد مكانه من وقت الحذف ← رسالة أو None."""
    if t.kind == "employee" and s.get(M.Employee, t.recordId) is not None:
        return "فيه موظف متسجّل بنفس الرقم المدني دلوقتي — مينفعش يترجع"
    if t.kind == "vehicle":
        plate = (rows.get("vehicles") or [{}])[0].get("plate")
        if plate and s.scalar(select(M.Vehicle.id).where(M.Vehicle.plate == plate)):
            return f"فيه سيارة متسجّلة باللوحة {plate} دلوقتي — مينفعش ترجع"
    if t.kind == "candidate":
        civil = ((rows.get("candidates") or [{}])[0].get("civil_id") or "").strip()
        if civil and (s.get(M.Employee, civil) or s.scalar(select(M.Candidate.id).where(M.Candidate.civilId == civil))):
            return f"الرقم المدني {civil} متسجّل لحد تاني دلوقتي — مينفعش يترجع"
    for p in rows.get("permits") or []:
        holder = s.get(M.Employee, p["employee_id"]) if p.get("employee_id") else s.get(M.Vehicle, p["vehicle_id"]) if p.get("vehicle_id") else None
        if holder is None and t.kind == "permit":
            return "صاحب التصريح مش موجود — استرجعه الأول من السلة"
        if p.get("permit_no") and s.scalar(select(M.Permit.id).where(M.Permit.typeId == p["type_id"], M.Permit.permitNo == p["permit_no"])):
            return f"رقم التصريح {p['permit_no']} متسجّل لتصريح تاني دلوقتي — مينفعش يترجع"
    return None


def restore(s, t):
    """رجوع المحذوف زي ما كان ← None، أو رسالة لو فيه تعارض."""
    data = json.loads(t.data or "{}")
    rows = data.get("rows") or {}
    msg = _conflict(s, t, rows)
    if msg:
        return msg
    # المراجع اللي اتمسحت من وقتها (شركة، مشروع، نوع تصريح، مكان) ← بتتشال عشان الصف يرجع
    exists = lambda model, i: bool(i) and s.get(model, i) is not None  # noqa: E731
    for r in rows.get("employee_affiliations") or []:
        if r.get("project_id") and not exists(M.Project, r["project_id"]):
            r["project_id"] = None
    rows["employee_affiliations"] = [r for r in rows.get("employee_affiliations") or [] if not r.get("company_id") or exists(M.Company, r["company_id"])]
    for table, fks in (("vehicles", (("company_id", M.Company), ("owner_company_id", M.Company), ("project_id", M.Project),
                                     ("affairs_project_id", M.Project), ("driver_id", M.Employee))),
                       ("candidates", (("target_company_id", M.Company), ("target_project_id", M.Project))),
                       ("permits", (("project_id", M.Project),))):
        for r in rows.get(table) or []:
            for col, model in fks:
                if r.get(col) and not exists(model, r[col]):
                    r[col] = None
    rows["permits"] = [r for r in rows.get("permits") or [] if exists(M.PermitType, r.get("type_id"))]
    kept = {r["id"] for r in rows["permits"]}
    rows["permit_place_links"] = [r for r in rows.get("permit_place_links") or [] if r["permit_id"] in kept and exists(M.PermitPlace, r["place_id"])]
    for f in data.get("files") or []:
        _move(f["to"], f["from"])
    for table in [x.name for x in M.Base.metadata.sorted_tables if x.name in rows]:
        _insert(s, table, rows[table])
    s.flush()
    relink = data.get("relink") or {}
    for vid in relink.get("vehicles.driver_id") or []:
        v = s.get(M.Vehicle, vid)
        if v is not None and not v.driverId and not v.userName:
            v.driverId = t.recordId
    for lid in relink.get("hr_letters.employee_id") or []:
        x = s.get(M.HrLetter, lid)
        if x is not None and not x.employeeId:
            x.employeeId = t.recordId
    shutil.rmtree(db.data_path("trash", t.id), ignore_errors=True)
    s.delete(t)
    return None


def purge(s, t):
    """حذف نهائي: ملفاته في السلة، ومرفقات الموظف (لو مفيش موظف رجع بنفس الرقم)."""
    shutil.rmtree(db.data_path("trash", t.id), ignore_errors=True)
    if t.kind == "employee" and s.get(M.Employee, t.recordId) is None:
        for f in s.scalars(select(M.EmployeeFile).where(M.EmployeeFile.employeeId == t.recordId)):
            if f.path:
                try:
                    os.remove(db.resolve_file(f.path))
                except OSError:
                    pass
            s.delete(f)
    s.delete(t)


def purge_expired(s):
    """اللي عدّى عليه KEEP_DAYS يوم في السلة ← حذف نهائي."""
    cutoff = datetime.now() - timedelta(days=KEEP_DAYS)
    old = list(s.scalars(select(M.Trash).where(M.Trash.deletedAt < cutoff)))
    for t in old:
        purge(s, t)
    return len(old)


def visible(u, t):
    """المستخدم يشوف / يسترجع اللي معاه صلاحية حذفه وفي نطاق شركاته."""
    if not u.can(KINDS[t.kind][1]):
        return False
    cos = json.loads(t.companyIds or "[]")
    return u.allCompanies or not cos or any(u.company_ok(c) for c in cos)


def to_api(t):
    data = json.loads(t.data or "{}")
    return {"id": t.id, "kind": t.kind, "kindLabel": KINDS[t.kind][0], "recordId": t.recordId, "label": t.label,
            "summary": data.get("summary") or {}, "deletedBy": t.deletedBy, "deletedAt": db.ser(t.deletedAt),
            "purgeAt": db.ser((t.deletedAt + timedelta(days=KEEP_DAYS)).date()) if t.deletedAt else None}
