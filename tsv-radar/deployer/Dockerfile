# deployer — tiny sidecar that turns a GitHub push webhook into `deploy.sh`.
# Based on docker:cli so it has the docker CLI + compose plugin; adds git and
# adnanh/webhook. Talks to the host daemon through the mounted docker socket.

FROM docker:cli

ARG TARGETARCH=amd64
ARG WEBHOOK_VERSION=2.8.3

RUN apk add --no-cache git bash curl ca-certificates \
  && curl -fsSL "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VERSION}/webhook-linux-${TARGETARCH}.tar.gz" \
     | tar -xz -C /tmp \
  && mv /tmp/webhook-linux-${TARGETARCH}/webhook /usr/local/bin/webhook \
  && rm -rf /tmp/webhook-linux-${TARGETARCH} \
  && git config --global --add safe.directory '*'

COPY hooks.json /etc/webhook/hooks.json

EXPOSE 9000
CMD ["webhook", "-hooks", "/etc/webhook/hooks.json", "-template", "-port", "9000", "-verbose", "-hotreload"]
