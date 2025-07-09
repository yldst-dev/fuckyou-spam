#!/bin/bash

# Rocky Linux용 텔레그램 스팸 봇 배포 스크립트
echo "🐧 Rocky Linux용 텔레그램 스팸 봇 배포 시작..."

# 사용자 정보 확인
echo "📋 현재 사용자 정보:"
echo "사용자: $(whoami)"
echo "UID: $(id -u)"
echo "GID: $(id -g)"

# 환경변수 파일 확인
if [ ! -f ".env" ]; then
    echo "❌ .env 파일이 없습니다. .env.example을 참조하여 .env 파일을 생성하세요."
    exit 1
fi

# 필요한 디렉터리 생성
echo "📁 필요한 디렉터리 생성..."
mkdir -p logs data

# 현재 사용자의 UID/GID로 디렉터리 소유권 설정
echo "🔒 디렉터리 소유권 설정..."
sudo chown -R $(id -u):$(id -g) logs data

# 디렉터리 권한 설정
echo "📝 디렉터리 권한 설정..."
chmod -R 755 logs data

# SELinux 설정 (Rocky Linux)
echo "🛡️ SELinux 설정 확인 및 적용..."
if command -v getenforce &> /dev/null && [ "$(getenforce)" != "Disabled" ]; then
    echo "SELinux가 활성화되어 있습니다. Docker 컨테이너 권한을 설정합니다..."
    
    # SELinux 불린 설정
    sudo setsebool -P container_manage_cgroup on 2>/dev/null || echo "⚠️ container_manage_cgroup 설정 실패"
    
    # 파일 컨텍스트 설정 (semanage가 있는 경우)
    if command -v semanage &> /dev/null; then
        sudo semanage fcontext -a -t container_file_t "$(pwd)/logs(/.*)?" 2>/dev/null || echo "logs 컨텍스트 이미 설정됨"
        sudo semanage fcontext -a -t container_file_t "$(pwd)/data(/.*)?" 2>/dev/null || echo "data 컨텍스트 이미 설정됨"
        sudo restorecon -R logs data
        echo "✅ SELinux 컨텍스트 설정 완료"
    else
        echo "⚠️ semanage 명령어가 없습니다. policycoreutils-python-utils 패키지를 설치하세요:"
        echo "   sudo dnf install policycoreutils-python-utils"
    fi
else
    echo "ℹ️ SELinux가 비활성화되어 있습니다."
fi

# 환경변수 설정 (Docker Compose용)
echo "🔧 환경변수 설정..."
export UID=$(id -u)
export GID=$(id -g)

# 기존 컨테이너 중지 및 정리
echo "🛑 기존 컨테이너 중지 및 정리..."
docker-compose down --remove-orphans 2>/dev/null || echo "기존 컨테이너 없음"

# Docker 이미지 정리
echo "🧹 Docker 이미지 정리..."
docker image prune -f

# Docker 네트워크 정리
echo "🌐 Docker 네트워크 정리..."
docker network prune -f

# 새로운 이미지 빌드 및 컨테이너 시작
echo "🏗️ 새로운 이미지 빌드 및 시작..."
UID=$(id -u) GID=$(id -g) docker-compose up --build -d

# 컨테이너 시작 대기
echo "⏳ 컨테이너 시작 대기 (10초)..."
sleep 10

# 컨테이너 상태 확인
echo "📊 컨테이너 상태 확인..."
docker-compose ps

# 컨테이너 로그 확인
echo "📋 컨테이너 로그 확인..."
docker-compose logs --tail=50

# 디렉터리 상태 최종 확인
echo "📁 디렉터리 상태 최종 확인:"
ls -la logs data
echo ""
echo "SELinux 컨텍스트 확인:"
ls -Z logs data 2>/dev/null || echo "SELinux 정보 없음"

# 테스트 파일 생성 시도
echo "🧪 권한 테스트..."
test_file="data/.permission-test-$(date +%s)"
if echo "test" > "$test_file" 2>/dev/null; then
    rm -f "$test_file"
    echo "✅ 호스트에서 데이터 디렉터리 쓰기 권한 확인됨"
else
    echo "❌ 호스트에서 데이터 디렉터리 쓰기 권한 없음"
fi

echo ""
echo "🎉 배포 완료!"
echo ""
echo "📋 유용한 명령어:"
echo "  로그 실시간 확인: docker-compose logs -f"
echo "  컨테이너 상태 확인: docker-compose ps"
echo "  컨테이너 중지: docker-compose down"
echo "  컨테이너 재시작: docker-compose restart"
echo ""
echo "🔧 문제 해결:"
echo "  1. 권한 문제 시: sudo ./fix-permissions.sh"
echo "  2. SELinux 문제 시: sudo setenforce 0 (임시) 또는 SELinux 정책 수정"
echo "  3. 환경변수 확인: cat .env" 