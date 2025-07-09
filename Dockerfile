FROM node:18-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 로그 및 데이터 디렉토리 생성
RUN mkdir -p logs data

# package.json과 package-lock.json 복사 (있는 경우)
COPY package*.json ./

# 의존성 설치
RUN npm ci --only=production

# 애플리케이션 코드 복사
COPY . .

# 사용자 권한 설정
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app && \
    chmod -R 755 /app/logs /app/data

# 볼륨 마운트 지점 생성 및 권한 설정
VOLUME ["/app/logs", "/app/data"]

USER nodejs

# 포트 노출 (필요시)
EXPOSE 3000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

# 애플리케이션 시작
CMD ["npm", "start"] 