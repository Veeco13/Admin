# -*- coding: utf-8 -*-
"""
نقل كل بيانات Lunx من قاعدة بيانات لأخرى (أي نوع يدعمه SQLAlchemy).

أمثلة:
  # من SQLite إلى PostgreSQL
  python db_transfer.py sqlite:///lunx.db "postgresql+psycopg://lunx:PASS@localhost/lunx"

  # من SQLite إلى SQL Server
  python db_transfer.py sqlite:///lunx.db "mssql+pyodbc://user:PASS@server/lunx?driver=ODBC+Driver+18+for+SQL+Server"

  # من MySQL إلى SQLite (نسخة محلية)
  python db_transfer.py "mysql+pymysql://user:PASS@host/lunx?charset=utf8mb4" sqlite:///lunx-copy.db

بعد النقل شغّل النظام على القاعدة الجديدة:
  set LUNX_DATABASE_URL=postgresql+psycopg://lunx:PASS@localhost/lunx     (ويندوز)
  export LUNX_DATABASE_URL=...                                           (لينكس)

⚠️ الجداول في القاعدة الهدف بتتمسح وتتملى من المصدر (بما فيهم المستخدمين).
المرفقات في uploads/ ملفات على القرص — مش جوه قاعدة البيانات، فمش محتاجة نقل.
"""
import sys

from sqlalchemy import MetaData, create_engine, func, select
from sqlalchemy.orm import sessionmaker

import db
import models as M


def transfer(src_url, dst_url, quiet=False):
    src = create_engine(src_url)
    dst = db.make_engine(dst_url)
    M.Base.metadata.create_all(dst)
    # قراءة المصدر بالانعكاس (reflection) — يشتغل حتى مع هيكل الإصدار الأول
    md = MetaData()
    md.reflect(src)
    tables = {}
    with src.connect() as conn:
        for t in md.sorted_tables:
            tables[t.name] = [dict(r) for r in conn.execute(select(t)).mappings()]
    src.dispose()
    S = sessionmaker(bind=dst, expire_on_commit=False)
    with S() as s:
        counts = db.import_tables(s, tables, replace=True, skip=())
        db.set_meta(s, "schema_version", db.SCHEMA_VERSION)
        s.commit()
        total = {m.__tablename__: s.scalar(select(func.count()).select_from(m)) for m in M.ALL_MODELS}
    dst.dispose()
    if not quiet:
        for k, v in total.items():
            print(f"  {k:24} {v}")
    return counts


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    print(f"نقل البيانات: {sys.argv[1]}  →  {sys.argv[2]}")
    transfer(sys.argv[1], sys.argv[2])
    print("تم.")
