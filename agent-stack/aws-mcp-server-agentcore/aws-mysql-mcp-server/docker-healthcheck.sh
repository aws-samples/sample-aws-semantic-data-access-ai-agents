#!/bin/sh
SERVER="mysql-mcp-server"

# Check if the server process is running
if pgrep -f "start_server.py" > /dev/null 2>&1; then
  echo -n "$SERVER is running";
  exit 0;
fi;

# Unhealthy
exit 1;
