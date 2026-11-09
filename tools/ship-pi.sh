#!/bin/bash
# Ships Mail to a Raspberry Pi: builds the image here (for arm64), sends the image
# over SSH, backs up on the Pi, starts the new one and waits until it's healthy. The one before is
# kept, so going back is one command.
#   tools/ship-pi.sh           ship this folder's committed code
#   tools/ship-pi.sh --back    go back to the image before
# Settings: private/install.env (start from deploy/install.env.example). Mail needs the Bassapps
# sign-in there first (the bassapps repo's tools/ship-pi.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f private/install.env ] || { echo "This installation's settings go in private/install.env: copy deploy/install.env.example there and fill it in."; exit 1; }
. private/install.env
: "${PI:?}" "${PI_DIR:?}" "${MAIL_USERS:?}" "${ACCOUNT_URL:?}" "${TIME_ZONE:?}"
ON_PI=$PI_DIR
pi() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$PI" "$@"; }

healthy() {
    for _ in $(seq 1 45); do
        state=$(pi "docker inspect -f '{{.State.Health.Status}}' bassapps-mail 2>/dev/null" || true)
        [ "$state" = healthy ] && return 0
        sleep 4
    done
    echo "Mail isn't healthy on the Pi (last: ${state:-no container}). Logs: ssh $PI docker logs --tail 50 bassapps-mail"
    return 1
}

if [ "${1:-}" = --back ]; then
    pi "docker image inspect bassapps-mail:previous >/dev/null && docker tag bassapps-mail:previous bassapps-mail:current && cd $ON_PI/mail && docker compose up -d"
    healthy && echo "Back on the image before."
    exit
fi

[ -z "$(git status --porcelain)" ] || { echo "There are uncommitted changes here: commit them first, so the Pi runs a known version."; exit 1; }
rev=$(git rev-parse --short HEAD)
pi "test -f $ON_PI/account/data/internal.key" || { echo "The sign-in service isn't on the Pi yet: ship it first (bassapps repo, tools/ship-pi.sh)."; exit 1; }

echo "Building $rev..."
docker build --quiet --platform linux/arm64 -t "bassapps-mail:$rev" . >/dev/null
echo "Sending the image to the Pi..."
docker save "bassapps-mail:$rev" | gzip -1 | pi 'gunzip | docker load' >/dev/null

echo "Backing up on the Pi, then starting $rev..."
pi "mkdir -p $ON_PI/mail/data $ON_PI/backups"
pi "cat > $ON_PI/mail/compose.yml" < deploy/pi/mail.compose.yml
printf 'MAIL_USERS=%s\nACCOUNT_URL=%s\nTIME_ZONE=%s\n' "$MAIL_USERS" "$ACCOUNT_URL" "$TIME_ZONE" | pi "cat > $ON_PI/mail/.env"
pi "cat > $ON_PI/backup.sh && chmod +x $ON_PI/backup.sh" < deploy/pi/backup.sh
pi "if docker ps --format '{{.Names}}' | grep -qx bassapps-mail; then docker exec bassapps-mail node engine/bin/backup.ts /backups/ship-\$(date +%F-%H%M)-mail; fi"
pi "if docker image inspect bassapps-mail:current >/dev/null 2>&1; then docker tag bassapps-mail:current bassapps-mail:previous; fi; docker tag bassapps-mail:$rev bassapps-mail:current"
pi "cd $ON_PI/mail && docker compose up -d"
healthy
pi "docker image ls bassapps-mail --format '{{.Tag}}' | grep -v -x -e current -e previous -e $rev | xargs -r -I{} docker rmi bassapps-mail:{} >/dev/null 2>&1 || true"
echo "Shipped $rev to the Pi. Health: $(pi 'docker exec bassapps-mail node -e "fetch(\"http://127.0.0.1:3100/api/v2/health\").then(r => r.text()).then(console.log)"')"
