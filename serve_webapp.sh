#!/usr/bin/env bash
# Serves the ARG Pipeline Explorer front-end at http://localhost:8010
exec python3 -m http.server 8010 -d "$(dirname "$0")/webapp"
