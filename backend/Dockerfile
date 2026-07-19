FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PYTHONIOENCODING=utf-8 \
    HOST=0.0.0.0 \
    PORT=8000 \
    HARVEST_ROOT=/data/harvested_kernels

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r ./requirements.txt

COPY . /app
RUN mkdir -p /data/harvested_kernels

EXPOSE 8000

CMD ["python", "main.py"]
