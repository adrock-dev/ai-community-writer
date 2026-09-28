// 금액 표기: 250000 → "25만원", 627000 → "62만 7천원", 44000 → "4만 4천원", 7500 → "7,500원".
// 본문도 같은 표기를 쓰도록 근거 자료부터 이 형태로 넣는다.

export function formatWon(amount: number): string {
  const n = Math.round(amount);
  if (n < 10_000) {
    return n % 1000 === 0 && n > 0 ? `${n / 1000}천원` : `${n.toLocaleString("ko-KR")}원`;
  }
  const man = Math.floor(n / 10_000);
  const rest = n % 10_000;
  const manText = `${man.toLocaleString("ko-KR")}만`;
  if (rest === 0) return `${manText}원`;
  if (rest % 1000 === 0) return `${manText} ${rest / 1000}천원`;
  return `${manText} ${rest.toLocaleString("ko-KR")}원`;
}

/** 부가세 포함 여부 표기. 알 수 없으면 확인이 필요하다고 적는다. */
export function vatLabel(vatIncluded: boolean | null | undefined): string {
  if (vatIncluded === true) return "부가세 포함";
  if (vatIncluded === false) return "부가세 별도";
  return "부가세 포함 여부 확인 필요";
}
