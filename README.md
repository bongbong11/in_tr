# 알잘딱깔센

SillyTavern용 한국어→영어 인풋 번역 확장입니다.

## 주요 기능

- 채팅 입력창의 `🌐` 버튼으로 현재 미전송 인풋만 번역
- 번역 완료 후 같은 버튼에서 `재번역 / 되돌리기`
- 번역 중 버튼을 다시 누르면 요청 취소
- Connection Manager 프로필에서 API 연결정보와 모델만 사용
  - 연결된 생성 Preset 미사용
  - Instruct 미사용
  - Prompt Post-Processing 미사용
- 참고 대화 범위 `0~5턴`
  - `1턴 = user + assistant` 한 세트
- 기존 Quick Reply의 메타 블록 제거 및 번역 결과 후처리 규칙 유지
- `[...]`는 번역 모델에게만 주는 일회성 지시
- `(OOC: ...)` 등 일반 괄호는 원문으로 정상 번역

## 번역 설정

마법봉(Extensions) 메뉴의 **알잘딱깔센**에서 관리합니다.

- `연결` 탭: Connection Profile / 참고 대화 턴 수
- `번역 설정` 탭: 설정 목록, 추가, 보기, 수정, 삭제
- 헤더에는 현재 적용 중인 설정 이름만 표시
- 설정 내용은 UI에서 한글로 작성·확인
- 저장할 때 선택한 번역 모델로 영어 SETTINGS를 한 번 생성해 내부 저장
- 실제 번역 요청에는 영어 저장본만 주입
- 기본 번역 설정은 비어 있으며 개인 캐릭터/작품용 내용은 포함하지 않습니다.

## 설치

SillyTavern의 third-party extension 설치 기능에서 이 저장소 URL을 사용하세요:

`https://github.com/bongbong11/in_tr`
