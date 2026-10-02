# 알잘딱깔센

SillyTavern용 한국어→영어 인풋 번역 확장입니다.

## 주요 기능

- 채팅 입력창의 `🌐` 버튼으로 현재 미전송 인풋만 번역
- 번역 완료 후 같은 버튼에서 `재번역 / 되돌리기`
- 번역 중 버튼을 다시 누르면 요청 취소
- **전송 시 자동 번역**을 켜면 한글 입력을 Enter / 전송 버튼으로 영어 번역 후 전송
  - 기본값은 꺼짐: 기존 지구본 수동 번역 유지
  - Shift+Enter 줄바꿈, 한글 조합 중 Enter, SillyTavern의 Enter 전송 설정 유지
  - 번역 실패·빈 결과·취소 시 원문 전송 금지
  - 번역 중 입력 수정 / 대화 변경 시 결과 적용 및 전송 금지
  - 연속 클릭 / Enter 반복으로 중복 번역·전송하지 않음
  - 영어만 있는 입력과 `/`로 시작하는 슬래시 명령은 기존 전송 동작 유지
- **채팅창 지구본 아이콘 표시** 체크로 표시 / 숨김 선택
  - 숨겨도 자동 번역 가능, 번역 중에는 취소 버튼이 잠시 표시됨
- 지구본은 채팅창 오른쪽 컨트롤의 맨 끝에 배치되며 CSS로 위치 조절 가능
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
- `연결` 탭: **전송 시 자동 번역**, **채팅창 지구본 아이콘 표시** 체크박스
- SillyTavern 기본 확장 설정 탭의 **알잘딱깔센 · 인풋 번역**에서도 같은 체크박스 사용 가능
- `번역 설정` 탭: 설정 목록, 추가, 보기, 수정, 삭제
- 헤더에는 현재 적용 중인 설정 이름만 표시
- 설정 내용은 UI에서 한글로 작성·확인
- 저장할 때 선택한 번역 모델로 영어 SETTINGS를 한 번 생성해 내부 저장
- 실제 번역 요청에는 영어 저장본만 주입
- 기본 번역 설정은 비어 있으며 개인 캐릭터/작품용 내용은 포함하지 않습니다.

## 설치

SillyTavern의 third-party extension 설치 기능에서 이 저장소 URL을 사용하세요:

`https://github.com/bongbong11/in_tr`

## 지구본 위치 CSS 조절

기본값은 오른쪽 컨트롤 중 맨 오른쪽입니다. 위치를 JS 인라인 스타일이나
`!important`로 강제하지 않으므로 SillyTavern 사용자 CSS에서 수정할 수 있습니다.

```css
#itr_translate_button {
    --itr-translate-button-order: 9999;
    --itr-translate-button-margin: 0;
}
```

`--itr-translate-button-order`를 낮추면 다른 컨트롤 앞에 배치할 수 있습니다.
직접 `order`, `margin`, `position`을 덮어써도 됩니다.

## 검증

`node --test tests/auto-send.test.cjs`로 전송 차단, 실패·취소, 중복 실행,
입력 / 대화 변경 및 수동 번역을 검증합니다. 실제 API와 SillyTavern 화면에서는
선택한 번역 프로필로 한글 한 줄을 입력하고 자동 번역 켜짐 / 꺼짐,
Shift+Enter, 취소 및 지구본 숨김을 확인하세요.
