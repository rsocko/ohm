FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ARG OHM_BUILD_SHA
ARG OHM_DEPLOYMENT_REVISION
LABEL org.opencontainers.image.revision=$OHM_BUILD_SHA \
      org.opencontainers.image.version=$OHM_DEPLOYMENT_REVISION

COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev \
	&& addgroup -S ohm && adduser -S ohm -G ohm \
	&& mkdir -p /app/data && chown -R ohm:ohm /app
USER ohm
ENV PORT=3000
ENV OHM_BUILD_SHA=$OHM_BUILD_SHA
ENV OHM_DEPLOYMENT_REVISION=$OHM_DEPLOYMENT_REVISION
EXPOSE 3000
CMD ["node", "build"]
