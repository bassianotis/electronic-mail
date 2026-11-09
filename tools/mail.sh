#!/bin/bash
# Runs Electronic Mail on this Mac: the engine (127.0.0.1:3100, data in engine/data) and the
# screens (http://localhost:5173). Both keep running after this Terminal window closes.
#   tools/mail.sh            start, e.g. after a laptop restart (does nothing if already running;
#                            refuses once Mail has moved to the Pi)
#   tools/mail.sh stop       stop both
#   tools/mail.sh restart    stop, then start: needed after engine code changes (the screens reload by themselves)
#   tools/mail.sh status     is it running?
# Logs: ~/Library/Logs/electronic-mail/engine.log and screens.log
set -euo pipefail
cd "$(dirname "$0")/.."
LOGS="$HOME/Library/Logs/electronic-mail"
mkdir -p "$LOGS"

pid_on() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null | head -1 || true; }
detach() { nohup perl -MPOSIX -e 'setsid(); exec @ARGV' "$@" < /dev/null & }
wait_for() { # port, seconds; "up" or "down"
    for _ in $(seq 1 $(( $2 * 4 ))); do
        if [ "$3" = up ] && [ -n "$(pid_on "$1")" ]; then return 0; fi
        if [ "$3" = down ] && [ -z "$(pid_on "$1")" ]; then return 0; fi
        sleep 0.25
    done
    return 1
}

status() {
    local e s
    e=$(pid_on 3100); s=$(pid_on 5173)
    if [ -n "$e" ]; then echo "engine:  running (pid $e)"; else echo "engine:  stopped"; fi
    if [ -n "$s" ]; then echo "screens: running (pid $s), http://localhost:5173"; else echo "screens: stopped"; fi
}

start() {
    # Moved to a server: two engines would both sync the same mailbox
    if [ -f engine/data/MOVED-TO-PI ]; then
        echo "Mail has moved to a server ($(cat engine/data/MOVED-TO-PI)), so this copy stays stopped:"
        echo "two engines would both sync, and both tidy, the same mailbox."
        exit 1
    fi
    if [ -z "$(pid_on 3100)" ]; then
        (cd engine && detach node bin/server.ts >> "$LOGS/engine.log" 2>&1)
        wait_for 3100 20 up || { echo "The engine didn't start. Last lines of $LOGS/engine.log:"; tail -5 "$LOGS/engine.log"; exit 1; }
    fi
    if [ -z "$(pid_on 5173)" ]; then
        detach npm run dev >> "$LOGS/screens.log" 2>&1
        wait_for 5173 20 up || { echo "The screens didn't start. Last lines of $LOGS/screens.log:"; tail -5 "$LOGS/screens.log"; exit 1; }
    fi
    status
}

stop() {
    local pid
    for port in 5173 3100; do
        pid=$(pid_on $port)
        if [ -n "$pid" ]; then kill "$pid"; fi
    done
    # The engine closes its mail connections before exiting.
    wait_for 3100 20 down && wait_for 5173 10 down || echo "Still shutting down; check again with: tools/mail.sh status"
    status
}

case "${1:-start}" in
    start) start ;;
    stop) stop ;;
    restart) stop; start ;;
    status) status ;;
    *) echo "usage: tools/mail.sh [start|stop|restart|status]"; exit 1 ;;
esac
