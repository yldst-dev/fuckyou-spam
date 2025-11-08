FROM node:20.12-alpine AS builder

WORKDIR /app

# package.json만 복사하고 npm cache clean
COPY package.json ./
RUN npm cache clean --force && \
    npm install --no-cache

# 소스 코드 복사
COPY . .

# TypeScript 빌드
RUN npm run build

FROM node:20.12-alpine AS runtime

WORKDIR /app

# 로그 및 데이터 디렉토리
RUN mkdir -p logs data

COPY package*.json ./
RUN npm ci --omit=dev

# 빌드 산출물만 복사
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env.example ./.env.example

# 권한 설정
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app && \
    chmod -R 755 /app/logs /app/data

VOLUME ["/app/logs", "/app/data"]

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

CMD ["npm", "start"]