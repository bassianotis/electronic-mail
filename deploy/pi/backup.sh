#!/bin/sh
# Nightly on the Pi (cron): a checked copy of the sign-in service's and Mail's durable data in
# backups/<date>/, keeping 14 days (the copies the ship scripts make go after 14 days too).
# Installed in <PI_DIR> by tools/ship-pi.sh, and run by cron, e.g. 15 3 * * * <PI_DIR>/backup.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
day=$(date +%F)
docker exec bassapps-account node service/bin/backup.ts "/backups/$day/account"
docker exec bassapps-mail node engine/bin/backup.ts "/backups/$day/mail"
find "$here/backups" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
