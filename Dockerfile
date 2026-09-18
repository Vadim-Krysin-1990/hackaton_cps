# Один образ: собранный интерфейс внутри, раздаётся тем же процессом, что и API.
# Так демо поднимается одной командой на чужой машине без интернета —
# ровно то, что просят в требованиях к сдаче почти любого хакатона.

FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Нужны качественные эмбеддинги вместо hash-фоллбэка — раскомментируйте.
# Тянет ~1,5 ГБ, поэтому по умолчанию выключено (CPU-колёса, без CUDA).
# COPY backend/requirements-ml.txt .
# RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
#     && pip install --no-cache-dir -r requirements-ml.txt

COPY backend/app ./app
COPY backend/scripts ./scripts
# промпты лежат в корне проекта и читаются при каждом анализе
COPY prompts /prompts
COPY --from=web /web/dist /frontend/dist

ENV APP_FRONTEND_DIST=/frontend/dist \
    APP_DATA_DIR=/data

EXPOSE 8000
# один рабочий процесс: встроенный Qdrant держит папку эксклюзивно
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
