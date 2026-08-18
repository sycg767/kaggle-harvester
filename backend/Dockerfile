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
# 国内服务器直连 PyPI 容易超时并触发依赖回溯，使用阿里云镜像保证解析稳定。
RUN pip install --no-cache-dir --index-url https://mirrors.aliyun.com/pypi/simple/ -r ./requirements.txt

COPY . /app
RUN mkdir -p /data/harvested_kernels

EXPOSE 8000

CMD ["python", "main.py"]
