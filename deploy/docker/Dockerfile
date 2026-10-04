FROM python:3.11-slim

WORKDIR /app

# 安装必要的图像基础库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 确保业务文件与资源目录就绪
RUN mkdir -p assets/images assets/manuals uploads exports "Excel 模版" data

EXPOSE 8000

ENV HOST=0.0.0.0
ENV PORT=8000
ENV HEADLESS=true

# 使用 Gunicorn 启动（2 个 worker 进程，4 个线程，配合 SQLite WAL 模式保证高并发与稳定性）
CMD ["gunicorn", "-w", "2", "--threads", "4", "-b", "0.0.0.0:8000", "--timeout", "120", "app:app"]
