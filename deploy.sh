#!/bin/bash

# 텔레그램 스팸 봇 배포 스크립트
echo "🚀 텔레그램 스팸 봇 배포 시작..."

# 필요한 디렉토리 생성
echo "📁 필요한 디렉토리 생성..."
mkdir -p logs data

# 디렉토리 권한 설정
echo "🔒 디렉토리 권한 설정..."
chmod 755 logs data

# 기존 컨테이너 중지 및 삭제
echo "🛑 기존 컨테이너 중지..."
docker-compose down

# 이미지 제거 (새로 빌드하기 위해)
echo "🧹 기존 이미지 제거..."
docker image prune -f

# 새로운 이미지 빌드 및 컨테이너 시작
echo "🏗️ 새로운 이미지 빌드 및 시작..."
docker-compose up --build -d

# 컨테이너 상태 확인
echo "📊 컨테이너 상태 확인..."
docker-compose ps

# 로그 출력 (30초 후 중지)
echo "📋 초기 로그 출력 (30초)..."
timeout 30 docker-compose logs -f || true

echo "✅ 배포 완료!"
echo "📋 로그 확인: docker-compose logs -f"
echo "🛑 중지: docker-compose down"