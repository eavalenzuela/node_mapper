# node_mapper -- Flask graph editor. Two deps, no build step.
FROM python:3.12-slim
WORKDIR /app

# Deps first so app edits don't bust the pip layer.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY node_mapper.py ./
COPY static ./static

# The app derives DB_PATH from __file__, so the sqlite file is always
# /app/graph.db and cannot be relocated without patching the source. compose
# bind-mounts the host's (gitignored) graph.db onto it to persist state.
ENV HOST=0.0.0.0 \
    PORT=5000
EXPOSE 5000

# python one-liner rather than curl: the slim image ships neither curl nor wget.
# /graph is an unauthenticated JSON endpoint that touches the real app state.
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/graph')" || exit 1

CMD ["python", "node_mapper.py"]
