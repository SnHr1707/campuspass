# syntax=docker/dockerfile:1.7
# ---- Stage 1: build the jar with Maven --------------------------------------
# Java bytecode is the same on every CPU, so this stage always runs natively (fast).
FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q package -DskipTests \
 && java -Djarmode=tools -jar target/event-service.jar extract --layers --launcher --destination /extracted

# ---- Stage 2: JRE only (no JDK, no Maven) -----------------------------------
FROM eclipse-temurin:21-jre-alpine
LABEL org.opencontainers.image.source="https://github.com/SnHr1707/campuspass" \
      org.opencontainers.image.description="CampusPass event-service"
# Apply OS security patches released after the base image was published.
RUN apk upgrade --no-cache \
 && addgroup -S app && adduser -S -G app -u 10001 app
WORKDIR /app
# Layers ordered from least to most frequently changed, so code changes reuse cached dependency layers.
COPY --from=build /extracted/dependencies/ ./
COPY --from=build /extracted/spring-boot-loader/ ./
COPY --from=build /extracted/snapshot-dependencies/ ./
COPY --from=build /extracted/application/ ./
USER 10001
EXPOSE 8081
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/health/liveness || exit 1
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
