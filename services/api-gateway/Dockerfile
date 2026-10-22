# syntax=docker/dockerfile:1.7
# NGINX API gateway. The official image renders /etc/nginx/templates/*.template
# with environment variables at start-up, so the same image works in Compose and Kubernetes.
FROM nginxinc/nginx-unprivileged:1.31-alpine
LABEL org.opencontainers.image.source="https://github.com/SnHr1707/campuspass" \
      org.opencontainers.image.description="CampusPass API gateway"
ENV AUTH_UPSTREAM=auth-service:3001 \
    EVENT_UPSTREAM=event-service:8081 \
    BOOKING_UPSTREAM=booking-service:3002 \
    TICKET_UPSTREAM=ticket-service:8000 \
    RATE_LIMIT_PER_IP=100r/s \
    RATE_BURST_PER_IP=200 \
    RATE_LIMIT_AUTH=20r/s \
    RATE_BURST_AUTH=50 \
    RATE_LIMIT_BOOKING=2r/s \
    RATE_BURST_BOOKING=5
# Apply OS security patches released after the base image was published.
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx.conf /etc/nginx/nginx.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
# nginx-unprivileged already defaults to this user; stating it makes the intent explicit.
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
