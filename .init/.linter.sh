#!/bin/bash
cd /home/kavia/workspace/code-generation/city-traffic-insights-224098-224107/traffic_backend
npm run lint
LINT_EXIT_CODE=$?
if [ $LINT_EXIT_CODE -ne 0 ]; then
  exit 1
fi

