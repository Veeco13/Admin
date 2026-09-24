# syntax=docker/dockerfile:1
# Lunx — صورة Docker للإنتاج
#   docker compose up -d --build
FROM python:3.12-slim-bookworm

# 1 = LibreOffice + خطوط عربي لتحويل العقود PDF (الصورة بتكبر ~450MB). 0 = من غير PDF
ARG WITH_PDF=1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Kuwait \
    LANG=C.UTF-8 \
    LUNX_DATA_DIR=/data \
    LUNX_AUTO_MIGRATE=0 \
    PORT=5050

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends tzdata; \
    if [ "$WITH_PDF" = "1" ]; then \
      apt-get install -y --no-install-recommends \
        libreoffice-writer-nogui fonts-noto-core fonts-noto-ui-core fonts-liberation2 fonts-dejavu-core fonts-kacst; \
    fi; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-docker.txt ./
RUN pip install -r requirements-docker.txt

COPY . .
RUN sed -i "s/\r$//" docker-entrypoint.sh && chmod +x docker-entrypoint.sh \
 && useradd --create-home --uid 1000 lunx \
 && mkdir -p /data \
 && chown -R lunx:lunx /data

USER lunx
VOLUME ["/data"]
EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5050/healthz', timeout=4)" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["serve"]
