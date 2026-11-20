# One image serves everything: the FastAPI backend, the ad-admin console and the phone shop (built frontend).
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir numpy fastapi "uvicorn[standard]" "pyjwt[crypto]"
COPY backend/pyproject.toml backend/README.md ./backend/
COPY backend/src ./backend/src
RUN pip install --no-cache-dir --no-deps ./backend
COPY --from=web /app/frontend/dist ./frontend/dist
COPY deploy/results ./deploy/results
ENV FEDAD_RESULTS=/app/deploy/results PYTHONUNBUFFERED=1
EXPOSE 10000
CMD ["sh", "-c", "uvicorn fedad.web.app:app --host 0.0.0.0 --port ${PORT:-10000} --proxy-headers --forwarded-allow-ips='*'"]
