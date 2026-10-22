#!/bin/sh
# Creates one database and one user per service (database-per-service pattern).
# Runs once, the first time the PostgreSQL volume is created.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE USER auth    WITH PASSWORD '${AUTH_DB_PASSWORD}';
CREATE USER booking WITH PASSWORD '${BOOKING_DB_PASSWORD}';
CREATE USER ticket  WITH PASSWORD '${TICKET_DB_PASSWORD}';
CREATE DATABASE auth_db    OWNER auth;
CREATE DATABASE booking_db OWNER booking;
CREATE DATABASE ticket_db  OWNER ticket;
REVOKE ALL ON DATABASE auth_db    FROM PUBLIC;
REVOKE ALL ON DATABASE booking_db FROM PUBLIC;
REVOKE ALL ON DATABASE ticket_db  FROM PUBLIC;
SQL
