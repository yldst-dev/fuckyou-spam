# Rocky Linux에서 Docker 데이터 디렉터리 접근 실패 문제 해결 가이드

## 🔍 문제 진단

Rocky Linux에서 Docker 컨테이너가 데이터 디렉터리에 접근할 수 없는 문제는 주로 다음과 같은 원인들에 의해 발생합니다:

### 1. **권한 불일치 (UID/GID 매핑 문제)**
- 호스트 시스템의 UID/GID와 컨테이너 내부의 UID/GID가 일치하지 않음
- Docker Compose에서 고정된 `user: "1001:1001"` 설정 사용 시 문제 발생

### 2. **SELinux 정책 차단**
- Rocky Linux의 기본 SELinux 정책이 Docker 볼륨 마운트를 차단
- 컨테이너가 호스트 디렉터리에 접근하는 것을 보안상 제한

### 3. **디렉터리 권한 부족**
- 호스트의 `logs/`, `data/` 디렉터리에 대한 읽기/쓰기 권한 부족
- 디렉터리가 존재하지 않거나 잘못된 소유권 설정

## 🛠️ 해결 방법

### **방법 1: 자동 스크립트 사용 (권장)**

Rocky Linux 서버에서 다음 명령어를 실행하세요:

```bash
# 프로젝트 디렉터리로 이동
cd /path/to/your/fuckyou-spam

# Rocky Linux용 배포 스크립트 실행
./deploy-rocky.sh
```

이 스크립트는 자동으로 다음 작업을 수행합니다:
- UID/GID 확인 및 환경변수 설정
- 디렉터리 권한 설정
- SELinux 컨텍스트 설정
- Docker 컨테이너 재시작

### **방법 2: 수동 단계별 해결**

#### **1단계: 사용자 정보 확인**
```bash
echo "사용자: $(whoami)"
echo "UID: $(id -u)"
echo "GID: $(id -g)"
```

#### **2단계: 디렉터리 권한 설정**
```bash
# 디렉터리 생성
mkdir -p logs data

# 소유권 설정
sudo chown -R $(id -u):$(id -g) logs data

# 권한 설정
chmod -R 755 logs data
```

#### **3단계: SELinux 설정**
```bash
# SELinux 상태 확인
getenforce

# SELinux가 활성화된 경우
sudo setsebool -P container_manage_cgroup on

# SELinux 컨텍스트 설정 (semanage 필요)
sudo dnf install policycoreutils-python-utils -y
sudo semanage fcontext -a -t container_file_t "$(pwd)/logs(/.*)?"
sudo semanage fcontext -a -t container_file_t "$(pwd)/data(/.*)?"
sudo restorecon -R logs data
```

#### **4단계: Docker Compose 실행**
```bash
# 환경변수 설정하여 실행
UID=$(id -u) GID=$(id -g) docker-compose up --build -d
```

### **방법 3: SELinux 임시 비활성화 (비권장)**

보안상 권장하지 않지만, 급한 경우 임시로 SELinux를 비활성화할 수 있습니다:

```bash
# 임시 비활성화 (재부팅 시 다시 활성화됨)
sudo setenforce 0

# Docker 컨테이너 재시작
docker-compose restart
```

## 🔧 Docker Compose 설정 개선

개선된 `docker-compose.yml` 설정:

```yaml
version: '3.8'

services:
  telegram-spam-bot:
    build: .
    container_name: telegram-spam-bot
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      # :Z 옵션으로 SELinux 컨텍스트 자동 설정
      - ./logs:/app/logs:Z
      - ./data:/app/data:Z
    # 환경변수로 동적 UID/GID 설정
    user: "${UID:-1000}:${GID:-1000}"
    environment:
      - NODE_ENV=production
      - TZ=Asia/Seoul
    # SELinux 보안 옵션
    security_opt:
      - label:type:container_runtime_t
    healthcheck:
      test: ["CMD", "node", "-e", "console.log('Health check')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  logs:
  data:
```

## 🐛 문제 진단 명령어

### **권한 확인**
```bash
# 디렉터리 권한 확인
ls -la logs data

# SELinux 컨텍스트 확인
ls -Z logs data

# 현재 사용자 정보
id
```

### **Docker 상태 확인**
```bash
# 컨테이너 상태
docker-compose ps

# 컨테이너 로그
docker-compose logs telegram-spam-bot

# 컨테이너 내부 권한 확인
docker-compose exec telegram-spam-bot ls -la /app/
```

### **SELinux 상태 확인**
```bash
# SELinux 상태
getenforce

# SELinux 정책 확인
getsebool container_manage_cgroup

# 거부된 접근 로그 확인
sudo ausearch -m avc -ts recent
```

## 🚨 일반적인 오류 메시지와 해결책

### **오류: "Permission denied"**
```
❌ 데이터 디렉터리 접근 실패
```
**해결책**: 디렉터리 소유권과 권한을 확인하고 수정
```bash
sudo chown -R $(id -u):$(id -g) logs data
chmod -R 755 logs data
```

### **오류: "mkdir: cannot create directory"**
```
Error response from daemon: failed to create shim: OCI runtime create failed
```
**해결책**: SELinux 컨텍스트 설정
```bash
sudo restorecon -R logs data
```

### **오류: "database is locked"**
```
❌ SQLite 데이터베이스 연결 실패
```
**해결책**: 데이터 디렉터리 권한 확인 및 기존 프로세스 종료
```bash
# 기존 컨테이너 완전 종료
docker-compose down
# 권한 재설정
./fix-permissions.sh
# 재시작
./deploy-rocky.sh
```

## 📋 체크리스트

배포 전 확인사항:

- [ ] `.env` 파일이 올바르게 설정되었는가?
- [ ] `logs/`, `data/` 디렉터리가 존재하는가?
- [ ] 디렉터리 소유권이 현재 사용자로 설정되었는가?
- [ ] SELinux 컨텍스트가 올바르게 설정되었는가?
- [ ] Docker 및 Docker Compose가 설치되어 있는가?
- [ ] 사용자가 docker 그룹에 속해 있는가?

## 🔗 추가 리소스

- [Docker와 SELinux 공식 문서](https://docs.docker.com/storage/bind-mounts/#configure-the-selinux-label)
- [Rocky Linux SELinux 가이드](https://docs.rockylinux.org/guides/security/learning_selinux/)
- [Docker Compose 사용자 설정](https://docs.docker.com/compose/compose-file/compose-file-v3/#user)

## 💡 팁

1. **개발 환경에서는** SELinux를 임시로 비활성화하여 테스트할 수 있지만, 프로덕션에서는 권장하지 않습니다.

2. **정기적인 로그 확인**을 통해 권한 문제를 조기에 발견할 수 있습니다:
   ```bash
   docker-compose logs -f | grep -i "permission\|denied"
   ```

3. **백업 복구 시**에도 권한 설정을 다시 해야 할 수 있습니다.

4. **시스템 업데이트 후**에는 SELinux 정책이 변경될 수 있으므로 재설정이 필요할 수 있습니다. 