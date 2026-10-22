# syntax=docker/dockerfile:1.7
# ---- Stage 1: build a virtualenv with the dependencies ----------------------
FROM python:3.13-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
WORKDIR /build
COPY requirements.txt .
RUN /venv/bin/pip install -r requirements.txt

# ---- Stage 2: runtime with only the venv and the app code -------------------
FROM python:3.13-slim
LABEL org.opencontainers.image.source="https://github.com/SnHr1707/campuspass" \
      org.opencontainers.image.description="CampusPass ticket-service"
ENV PATH=/venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
COPY --from=build /venv /venv
WORKDIR /app
COPY app ./app
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" || exit 1
CMD ["uvicorn", "app.main:build", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
