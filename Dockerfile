FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev \
	&& addgroup -S ohm && adduser -S ohm -G ohm \
	&& mkdir -p /app/data && chown -R ohm:ohm /app
USER ohm
ENV PORT=3000
EXPOSE 3000
CMD ["node", "build"]
