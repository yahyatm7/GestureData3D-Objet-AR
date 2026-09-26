#!/usr/bin/env sh
# Lance un petit serveur local puis ouvre http://localhost:8000
cd "$(dirname "$0")"
echo "GestureData 3D : http://localhost:8000  (Ctrl+C pour arrêter)"
( sleep 1; (xdg-open http://localhost:8000 || open http://localhost:8000) >/dev/null 2>&1 ) &
python3 -m http.server 8000 || python -m http.server 8000
