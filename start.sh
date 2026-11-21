#!/bin/sh
# Installs (first time), builds and starts Krishbot.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Node.js 22.13+ is needed: https://nodejs.org"; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a==22&&b>=13)?0:1)" || { echo "Node.js 22.13+ is needed: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install || exit 1
[ -f web/dist/index.html ] && [ -f server/dist/index.js ] || npm run build || exit 1
echo "Krishbot: http://localhost:8787"
exec npm run serve
