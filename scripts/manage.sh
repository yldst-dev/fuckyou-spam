#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

function usage() {
  cat <<'USAGE'
Usage: scripts/manage.sh <command>

Commands:
  deploy             Build and start containers with compose
  fix-permissions    Fix logs/data ownership and SELinux context (if available)
  down               Stop containers
  restart            Restart containers
  logs               Follow logs
  ps                 Show container status

Examples:
  bash scripts/manage.sh deploy
  bash scripts/manage.sh fix-permissions
USAGE
}

function dc() {
  # Wrapper for docker compose vs docker-compose
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

function ensure_env() {
  if [[ ! -f .env ]]; then
    echo "❌ .env 파일이 없습니다. .env.example을 참조하여 .env 파일을 생성하세요." >&2
    exit 1
  fi
}

function ensure_dirs() {
  echo "📁 필요한 디렉터리 생성..."
  mkdir -p logs data
  echo "🔒 디렉터리 권한 설정..."
  chmod -R 755 logs data || true
}

function fix_permissions() {
  echo "🔧 권한 설정 및 SELinux 컨텍스트 적용 시도..."
  local uid gid
  uid=$(id -u)
  gid=$(id -g)
  if command -v sudo >/dev/null 2>&1; then
    sudo chown -R "$uid":"$gid" logs data || true
  else
    chown -R "$uid":"$gid" logs data || true
  fi

  # SELinux context (if available)
  if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" != "Disabled" ]]; then
    echo "🛡️ SELinux 활성화됨. 컨텍스트 설정 중..."
    if command -v semanage >/dev/null 2>&1; then
      if command -v sudo >/dev/null 2>&1; then
        sudo setsebool -P container_manage_cgroup on || true
        sudo semanage fcontext -a -t container_file_t "$(pwd)/logs(/.*)?" || true
        sudo semanage fcontext -a -t container_file_t "$(pwd)/data(/.*)?" || true
        sudo restorecon -R logs data || true
      else
        setsebool -P container_manage_cgroup on || true
        semanage fcontext -a -t container_file_t "$(pwd)/logs(/.*)?" || true
        semanage fcontext -a -t container_file_t "$(pwd)/data(/.*)?" || true
        restorecon -R logs data || true
      fi
      echo "✅ SELinux 컨텍스트 설정 완료"
    else
      echo "⚠️ semanage 없음. policycoreutils-python-utils 패키지 설치를 고려하세요."
    fi
  else
    echo "ℹ️ SELinux 비활성화 상태 또는 사용 불가. 컨텍스트 설정 건너뜀."
  fi
}

function compose_up() {
  echo "🏗️ 새로운 이미지 빌드 및 시작..."
  local uid gid compose_env
  uid=$(id -u)
  gid=$(id -g)
  compose_env=".env.compose"
  # Create a compose env file injecting UID/GID without touching shell readonly UID
  grep -vE '^(UID|GID)=' .env > "$compose_env" || cp .env "$compose_env"
  echo "UID=$uid" >> "$compose_env"
  echo "GID=$gid" >> "$compose_env"
  dc --env-file "$compose_env" up --build -d
  echo "📊 컨테이너 상태 확인..."
  dc ps
  echo "📋 초기 로그 출력 (30초)..."
  if docker compose version >/dev/null 2>&1; then
    timeout 30 docker compose logs -f || true
  else
    timeout 30 docker-compose logs -f || true
  fi
  rm -f "$compose_env" || true
}

function prune() {
  echo "🧹 Docker 이미지/네트워크 정리..."
  docker image prune -f || true
  docker network prune -f || true
}

cmd=${1:-}
case "$cmd" in
  deploy)
    ensure_env
    ensure_dirs
    fix_permissions
    dc down --remove-orphans || true
    prune
    compose_up
    ;;
  fix-permissions)
    ensure_dirs
    fix_permissions
    ;;
  down)
    dc down
    ;;
  restart)
    dc restart
    ;;
  logs)
    dc logs -f
    ;;
  ps)
    dc ps
    ;;
  *)
    usage
    exit 1
    ;;
esac

echo "🎉 작업 완료"