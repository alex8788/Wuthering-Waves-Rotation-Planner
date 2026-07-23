<p align="center">
  <img src="../public/Phoebe.svg" width="96" alt="logo" />
</p>

<h1 align="center">명조 로테이션 플래너</h1>

<p align="center">
  《명조: 워더링 웨이브》 비주얼 로테이션 도구 — 드래그만으로 로테이션 완성, 학습 비용 제로, 설치·가입 불필요.
</p>

<p align="center">
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="../README.md">English</a> |
  <a href="README.ja.md">日本語</a> |
  <b>한국어</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?logo=vue.js" alt="Vue 3" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel" alt="Vercel" />
</p>

<p align="center">
  <a href="#live-demo">사이트 링크</a> ·
  <a href="#특징">특징</a> ·
  <a href="#스크린샷">스크린샷</a> ·
  <a href="#기능">기능</a> ·
  <a href="#키보드-단축키">단축키</a> ·
  <a href="#기술-스택">기술 스택</a>
</p>

---

## Live Demo

**[wuthering-waves-rotation-planner.vercel.app](https://wuthering-waves-rotation-planner.vercel.app/)**

### 전체 기능 개요

https://github.com/user-attachments/assets/9552c0a0-a7aa-43bf-8474-0b78d339fdd7

### 단축키 입력 모드

https://github.com/user-attachments/assets/bbc55605-ce35-4f11-9fdd-f8f708967fae

## 특징
* 완전 비주얼 조작
* 단축키 빠른 입력
* 설치 불필요
* 다국어 지원
* 인터랙티브 튜토리얼
* 캐릭터 데이터 자동 업데이트
* 로컬 저장 및 이미지 내보내기

## 스크린샷

<img width="2680" height="1280" alt="스크린샷" src="https://github.com/user-attachments/assets/35039615-6f91-4554-a435-eb67ab2a34f6" />

## 기능

### 로테이션
- **드래그 조작**: 블록을 자유롭게 드래그할 수 있으며, 뒤쪽 블록은 자동으로 정렬·채워집니다
- **블록 편집**: 추가, 삭제, 복사, 붙여넣기, 잘라내기, 인라인 텍스트 편집
- **다중 선택**: Ctrl+클릭, 마우스 드래그 선택, 캐릭터 축 전체 선택
- **단축키 입력 모드**: 단축키와 매핑할 블록을 사용자 지정하여 단축키로 빠르게 삽입 — 탭/길게 누르기와 마우스 입력 지원
- **실행 취소/다시 실행**: 모든 작업의 스냅샷이 히스토리에 저장됩니다

### 영속화
- **템플릿 라이브러리**: 캐릭터별 자주 쓰는 스킬 조합을 저장
- **팀 저장**: 로테이션을 로컬에 저장하며 불러오기·이름 변경·고정·덮어쓰기 지원
- **다중 로테이션 탭**: 같은 팀에 대해 여러 로테이션 탭을 만들 수 있습니다

### 내보내기
- **이미지 내보내기**: 하나의 이미지로 병합하거나 여러 이미지를 ZIP으로 묶어 출력. 다배율 PNG 및 SVG 형식 지원

## 키보드 단축키

| 키 | 기능 |
| --- | --- |
| `A` / `D` (또는 `←` / `→`) | 이전 / 다음 블록 선택 |
| `W` / `S` (또는 `↑` / `↓`) | 이전 / 다음 캐릭터 축 선택 |
| `Space` | 블록 추가 |
| `Enter` | 선택한 블록 편집 |
| `Delete` / `Backspace` | 선택한 블록 삭제 |
| `Ctrl+A` | 모든 블록 선택 |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | 복사 / 잘라내기 / 붙여넣기 / 오른쪽으로 복제 |
| `Ctrl+Z` | 실행 취소 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 다시 실행 |
| `Ctrl+S` / `Ctrl+Shift+S` | 변경 사항 저장 / 다른 이름으로 저장 |
| `Escape` | 모든 선택 해제 |
| `Tab` | 사이드바 열기 / 닫기 |
| `Shift`+휠 | 로테이션 가로 스크롤 |

### 단축키 입력 모드

| 키 | 기능 |
| --- | --- |
| `F` | 단축키 입력 모드 진입 |
| `1` / `2` / `3` (또는 휠) | 캐릭터 축 전환 |
| `Delete` / `Backspace` | 타임라인 맨 끝의 블록 삭제 |
| `Escape` | 단축키 입력 모드 종료 |

## 지원 언어

페이지 오른쪽 위의 톱니바퀴 아이콘에서 언어를 전환할 수 있습니다.

* 繁體中文
* 简体中文
* English (기본값)
* 日本語
* 한국어

## 기술 스택

- **프레임워크**: Vue 3 + TypeScript + Vite + Pinia + TailwindCSS
- **드래그 앤 드롭**: VueDraggablePlus
- **내보내기**: html-to-image + JSZip
- **다국어**: vue-i18n
- **튜토리얼**: driver.js
- **영속화**: LocalStorage

## API 사용

캐릭터 및 속성 데이터 출처: [encore.moe](https://encore.moe/?lang=en)

## 로컬 개발

```bash
npm install      # 의존성 설치
npm run dev      # 개발 서버 시작
npm run build    # 타입 체크 + 빌드
```

## License

이 프로젝트는 [MIT License](../LICENSE)에 따라 배포됩니다.

## 기타 안내

1. 일부 번역에 오류가 있을 수 있습니다. 제보를 환영합니다.
2. VS Code 내장 브라우저에서 이미지를 내보낼 때 저장 대화상자가 두 번 나타납니다. 첫 번째는 손상된 파일이고, 두 번째가 정상 파일입니다.
