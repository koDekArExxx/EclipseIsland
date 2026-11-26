FROM python:3.12-slim
WORKDIR /app
COPY bot.py /app/bot.py
RUN useradd --uid 10001 --create-home eclipse && mkdir /data && chown eclipse:eclipse /data
ENV DATA_DIR=/data PYTHONUNBUFFERED=1
USER 10001
VOLUME ["/data"]
HEALTHCHECK --start-period=90s --interval=60s CMD python /app/bot.py --health
CMD ["python", "/app/bot.py"]
