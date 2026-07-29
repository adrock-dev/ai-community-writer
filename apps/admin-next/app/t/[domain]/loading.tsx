/**
 * 도메인 화면 이동 중 표시.
 *
 * 이 경계가 없으면 App Router 는 서버 컴포넌트가 끝날 때까지 **이전 화면을 그대로 둔다** —
 * 주소도 안 바뀌고 아무 표시도 없다. DomainClient 는 큰 컴포넌트라 개발 모드의 온디맨드
 * 컴파일이 수십 초 걸리는데, 그동안 운영자에게는 링크가 죽은 것으로 보인다(셸 배너의
 * 「연결하러 가기」가 실제로 그렇게 보였다).
 */
export default function Loading() {
  return <div className="card card-pad"><p className="muted">도메인 화면을 여는 중...</p></div>;
}
