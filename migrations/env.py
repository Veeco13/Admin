# -*- coding: utf-8 -*-
"""بيئة Alembic لـ Lunx: بتستخدم نفس الاتصال والموديلات بتوعة التطبيق."""
from alembic import context

import db
import models as M

config = context.config
target_metadata = M.Base.metadata


def _configure(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=connection.dialect.name == "sqlite",   # SQLite محتاج إعادة بناء الجدول لتعديل القيود
        compare_type=True,
    )


def run_migrations_offline():
    context.configure(url=db.DATABASE_URL, target_metadata=target_metadata, literal_binds=True,
                      render_as_batch=db.DATABASE_URL.startswith("sqlite"), compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connection = config.attributes.get("connection")
    if connection is not None:                 # مستدعى من db.init_db()
        _configure(connection)
        with context.begin_transaction():
            context.run_migrations()
        return
    with db.engine.connect() as connection:    # مستدعى من سطر الأوامر (manage_db.py / alembic)
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        _configure(connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
