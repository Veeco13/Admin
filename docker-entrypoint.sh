#!/bin/sh
# Lunx — نقطة البداية داخل الـ container
#   serve (الافتراضي)    : تطبيق تعديلات الهيكل مرة واحدة ثم تشغيل gunicorn
#   manage <أمر>         : python manage_db.py <أمر>   (info / check / backup / restore / transfer …)
#   import-sqlite <ملف>  : نقل بيانات lunx.db (من ويندوز مثلاً) للقاعدة الحالية + نسخ uploads/ اللي جنبه
#   أي أمر تاني          : بيتنفذ زي ما هو
set -e

case "$1" in
  serve)
    echo "[Lunx] تطبيق تعديلات هيكل قاعدة البيانات…"
    python manage_db.py upgrade
    echo "[Lunx] تشغيل السيرفر على المنفذ ${PORT:-5050} (${WORKERS:-3} workers)"
    exec gunicorn app:app \
      --bind "0.0.0.0:${PORT:-5050}" \
      --workers "${WORKERS:-3}" \
      --threads "${THREADS:-4}" \
      --timeout "${TIMEOUT:-120}" \
      --access-logfile - \
      --error-logfile - \
      --forwarded-allow-ips "*"
    ;;
  import-sqlite)
    SRC="${2:-/import/lunx.db}"
    [ -f "$SRC" ] || { echo "مش لاقي $SRC — اعمل mount للملف على /import/lunx.db"; exit 1; }
    python manage_db.py upgrade
    TARGET="${LUNX_DATABASE_URL:-sqlite:///${LUNX_DATA_DIR:-/data}/lunx.db}"
    echo "[Lunx] نقل البيانات من $SRC إلى القاعدة الحالية…"
    python manage_db.py transfer "sqlite:///$SRC" "$TARGET"
    SRC_DIR="$(dirname "$SRC")"
    for d in uploads templates_docs; do
      if [ -d "$SRC_DIR/$d" ]; then
        echo "[Lunx] نسخ $d/ …"
        mkdir -p "${LUNX_DATA_DIR:-/data}/$d"
        cp -rn "$SRC_DIR/$d/." "${LUNX_DATA_DIR:-/data}/$d/"
      fi
    done
    python manage_db.py check
    ;;
  manage)
    shift
    exec python manage_db.py "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
