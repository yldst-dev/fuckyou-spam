#!/bin/bash

echo "🔍 Rocky Linux에서 Docker 데이터 디렉터리 권한 문제 해결 스크립트"

# 현재 사용자 정보 확인
echo "📋 현재 사용자 정보:"
echo "사용자: $(whoami)"
echo "UID: $(id -u)"
echo "GID: $(id -g)"
echo "그룹: $(groups)"

# 프로젝트 디렉터리로 이동 (현재 디렉터리 사용)
# cd /Users/sumin/Documents/%EC%BD%94%EB%94%A9%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8/fuckyou-spam

# 필요한 디렉터리 생성
echo "📁 필요한 디렉터리 생성..."
mkdir -p logs data

# 현재 사용자의 UID/GID로 디렉터리 소유권 설정
echo "🔒 디렉터리 소유권 설정..."
sudo chown -R $(id -u):$(id -g) logs data

# 디렉터리 권한 설정 (읽기/쓰기/실행)
echo "📝 디렉터리 권한 설정..."
chmod -R 755 logs data

# SELinux 컨텍스트 설정 (Rocky Linux용)
echo "🛡️ SELinux 컨텍스트 설정..."
if command -v semanage &> /dev/null; then
    sudo setsebool -P container_manage_cgroup on
    sudo semanage fcontext -a -t container_file_t "$(pwd)/logs(/.*)?"
    sudo semanage fcontext -a -t container_file_t "$(pwd)/data(/.*)?"
    sudo restorecon -R logs data
    echo "✅ SELinux 컨텍스트 설정 완료"
else
    echo "⚠️ SELinux 도구가 설치되지 않음 (policycoreutils-python-utils 패키지 필요)"
fi

# 디렉터리 상태 확인
echo "📊 디렉터리 상태 확인:"
ls -la logs data
echo "SELinux 컨텍스트:"
ls -Z logs data 2>/dev/null || echo "SELinux 정보 없음"

echo "✅ 권한 설정 완료!"
