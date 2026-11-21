# The Treffpunkt's container image (plan § 2): Node only, no package from npm inside — the server
# uses Node's built-in modules alone, so only src/ and konfiguration/ are copied. Runs as the
# unprivileged user `node`. bunny Magic Containers run linux/amd64 only.
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src
COPY --chown=root:root konfiguration ./konfiguration
# The commit this image is built from (tests.yml passes it); /gesund answers it, so Freigabe sees
# whether the new image runs or still the old one.
ARG STAND=unbekannt
RUN printf '%s\n' "$STAND" > stand.txt

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/gesund || exit 1

CMD ["node", "src/server.ts"]
