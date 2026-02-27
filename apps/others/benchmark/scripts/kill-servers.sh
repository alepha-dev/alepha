#!/usr/bin/env bash
# Kill any processes listening on benchmark ports (3001-3006)

PORTS=(3001 3002 3003 3004 3005 3006)
killed=0

for port in "${PORTS[@]}"; do
  pid=$(lsof -ti :"$port" 2>/dev/null)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null && echo "Killed PID $pid on :$port" && ((killed++))
  fi
done

if [ "$killed" -eq 0 ]; then
  echo "No servers running on ports 3001-3006"
fi
