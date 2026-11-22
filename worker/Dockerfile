# Ruta viva worker: polls the open-data feeds and serves the small /api/ endpoints.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RUTAVIVA_DATA=/data
WORKDIR /app
COPY requirements.txt .
# libexpat1: needed by osmium to read the OpenStreetMap extract.
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir $(grep -v '^pytest' requirements.txt) && useradd -u 1000 -m rv
COPY rutaviva ./rutaviva
USER 1000
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4)" || exit 1
CMD ["python", "-m", "rutaviva.main"]
