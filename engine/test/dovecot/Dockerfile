# Native multi-arch test server (the official dovecot/dovecot 2.3 image is amd64-only and
# crashes under Rosetta). Debian bookworm ships Dovecot 2.3.19 — the 2.3 line many hosts run.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends dovecot-imapd \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1000 vmail && useradd -u 1000 -g 1000 -d /srv/mail -M vmail \
    && mkdir -p /srv/mail && chown vmail:vmail /srv/mail
COPY dovecot.conf /etc/dovecot/dovecot.conf
EXPOSE 143
CMD ["dovecot", "-F"]
