import { describe, expect, it } from "vitest";
import {
  extractSearchCandidates, feeSubpageUrls, homepageUrlsFromPlaceText, limitPerHost, structuredFactsFromSources,
} from "../src/academy-research-web.js";

// 검색 HTML 에서 후보 URL 을 뽑을 때, 화면 동작용 네이버 인프라 URL 이 한도를 먼저
// 채워 실제 근거 페이지를 밀어내는 문제가 있었다(실측: 후보 31개 전부 인프라, 공식 홈페이지 0개).

// 실제 m.search.naver.com 응답 구조를 축약한 것. 인프라 URL 은 상단 스크립트에,
// 진짜 결과 링크는 한참 아래 <a href> 에 있다.
const SEARCH_HTML = `
<html><head>
<script>
  var keep = "https://apis.naver.com/naverSearchFe/naver_keep/naver_keep";
  var check = "https://apis.naver.com/naverSearchFe/naver_keep/v1_web_keep_check?type=bookmark";
  var subs = "https://gw.in.naver.com/home/api/v4/spaces/{=spaceId}/subscribes";
  var captcha = "https://captcha.nid.naver.com/nhncaptchav4.gif?key={=key}";
  var sound = "https://soundcaptcha.nid.naver.com/soundCaptcha.wav?key={=key}";
  var cr = "http://cr.naver.com";
</script>
</head><body>
  <a href="https://m.search.naver.com/search.naver?query=test">검색</a>
  <a href="https://m.place.naver.com/place/123456/home">플레이스</a>
  <a href="http://bbdrive.co.kr/">구포북부운전전문학원</a>
  <a href="http://bbdrive.co.kr/bbs/board.php?bo_table=08&amp;page=2">수강료 안내</a>
  <a href="https://blog.naver.com/someone/223456789">방문 후기</a>
  <a href="https://www.youtube.com/channel/UC8vPiHnMt0A9nyv6TNQy-Fw">유튜브</a>
  <a href="https://www.google.com/maps/search/%EA%B5%AC%ED%8F%AC">지도</a>
</body></html>`;

describe("extractSearchCandidates — href 링크만, 인프라 제외", () => {
  const urls = extractSearchCandidates(SEARCH_HTML);

  it("스크립트에 박힌 네이버 내부 인프라 URL을 후보로 잡지 않는다", () => {
    expect(urls.some((u) => u.includes("apis.naver.com"))).toBe(false);
    expect(urls.some((u) => u.includes("gw.in.naver.com"))).toBe(false);
    expect(urls.some((u) => u.includes("captcha.nid.naver.com"))).toBe(false);
    expect(urls.some((u) => u.includes("cr.naver.com"))).toBe(false);
  });

  it("공식 홈페이지·블로그 같은 실제 근거 링크를 잡는다", () => {
    expect(urls).toContain("http://bbdrive.co.kr/");
    expect(urls).toContain("https://blog.naver.com/someone/223456789");
  });

  it("href 의 &amp; 를 되돌려 실제 URL로 만든다", () => {
    expect(urls).toContain("http://bbdrive.co.kr/bbs/board.php?bo_table=08&page=2");
  });

  it("검색·플레이스·지도·영상은 후보에서 뺀다", () => {
    // 플레이스는 placeIds 경로로 따로 수집하므로 여기서 또 담으면 중복이다.
    expect(urls.some((u) => u.includes("place.naver.com"))).toBe(false);
    expect(urls.some((u) => u.includes("search.naver"))).toBe(false);
    expect(urls.some((u) => u.includes("youtube.com"))).toBe(false);
    expect(urls.some((u) => u.includes("google.com"))).toBe(false);
  });

  it("한도를 넘겨 수집하지 않는다", () => {
    expect(extractSearchCandidates(SEARCH_HTML, 1)).toHaveLength(1);
  });

  it("링크가 없으면 빈 배열", () => {
    expect(extractSearchCandidates("<html><body>없음</body></html>")).toEqual([]);
  });
});

describe("homepageUrlsFromPlaceText — 플레이스가 알려준 공식 홈페이지", () => {
  // 플레이스에는 수강료·셔틀·합격률이 없다. 공식 홈페이지 주소는 알려주므로 그걸 후보로 쓴다.
  const placeText = [
    "이름: 목포자동차운전전문학원",
    "분류: 운전학원",
    "전화: 0507-1339-1184",
    "홈페이지: https://www.mpdrive.co.kr, https://blog.naver.com/mpa0554",
  ].join("\n");

  it("홈페이지 줄에서 URL을 되읽는다", () => {
    expect(homepageUrlsFromPlaceText(placeText)).toEqual([
      "https://www.mpdrive.co.kr",
      "https://blog.naver.com/mpa0554",
    ]);
  });

  it("홈페이지 줄이 없으면 빈 배열", () => {
    expect(homepageUrlsFromPlaceText("이름: 구룡자동차운전전문학원\n전화: 063-535-9400")).toEqual([]);
  });

  it("근거가 될 수 없는 주소는 걸러낸다", () => {
    expect(homepageUrlsFromPlaceText("홈페이지: https://www.youtube.com/channel/abc, https://ok.co.kr"))
      .toEqual(["https://ok.co.kr"]);
  });
});

describe("feeSubpageUrls — 공식 홈페이지 첫 화면은 메뉴뿐이라 서브페이지를 따라간다", () => {
  // 실측: bbdrive.co.kr 첫 화면 937자에 '수강료안내' 는 메뉴 글자로만 있고 금액은 0건이었다.
  const HOME = `
    <a href="/bbs/board.php?bo_table=0203">수강료안내</a>
    <a href="/bbs/board.php?bo_table=08">셔틀버스</a>
    <a href="/bbs/board.php?bo_table=07">공지사항</a>
    <a href="https://blog.naver.com/other">블로그 후기</a>
    <a href="/intro.php">인사말</a>`;

  it("수강료·셔틀 링크만 같은 사이트 안에서 따라간다", () => {
    expect(feeSubpageUrls(HOME, "http://www.bbdrive.co.kr/")).toEqual([
      "http://www.bbdrive.co.kr/bbs/board.php?bo_table=0203",
      "http://www.bbdrive.co.kr/bbs/board.php?bo_table=08",
    ]);
  });

  it("외부 사이트로는 나가지 않는다", () => {
    const urls = feeSubpageUrls('<a href="https://other.co.kr/fee">수강료</a>', "http://www.bbdrive.co.kr/");
    expect(urls).toEqual([]);
  });

  it("한도를 지키고 자기 자신은 다시 담지 않는다", () => {
    expect(feeSubpageUrls(HOME, "http://www.bbdrive.co.kr/", 1)).toHaveLength(1);
    expect(feeSubpageUrls('<a href="/">수강료</a>', "http://www.bbdrive.co.kr/")).toEqual([]);
  });
});

describe("structuredFactsFromSources — 모델에 맡기지 않고 기계적으로 확정하는 값", () => {
  // 홈페이지·플레이스 URL 은 플레이스 JSON 에 구조화돼 있는데도 모델에 맡겼더니
  // 채움률이 58% 였다(파일럿 26곳). 원천 API 가 홈페이지를 주기 전까지 이 경로를 쓴다.
  const place = (homepageLine: string) => ({
    url: "https://m.place.naver.com/place/123456",
    text: ["이름: 목포자동차운전전문학원", "분류: 운전학원", homepageLine].join("\n"),
  });

  it("플레이스 URL 과 홈페이지를 함께 확정한다", () => {
    expect(structuredFactsFromSources([place("홈페이지: https://www.mpdrive.co.kr")])).toEqual({
      homepage_url: "https://www.mpdrive.co.kr",
      naver_place_url: "https://m.place.naver.com/place/123456",
    });
  });

  it("블로그보다 공식 홈페이지를 앞세운다", () => {
    const facts = structuredFactsFromSources([place("홈페이지: https://blog.naver.com/mpa0554, https://www.mpdrive.co.kr")]);
    expect(facts.homepage_url).toBe("https://www.mpdrive.co.kr");
  });

  it("블로그밖에 없으면 그거라도 쓴다(소규모 학원은 블로그가 홈페이지다)", () => {
    const facts = structuredFactsFromSources([place("홈페이지: https://blog.naver.com/mpa0554")]);
    expect(facts.homepage_url).toBe("https://blog.naver.com/mpa0554");
  });

  it("홈페이지 줄이 없으면 플레이스 URL 만 확정한다", () => {
    const facts = structuredFactsFromSources([{ url: "https://m.place.naver.com/place/9", text: "이름: 구룡" }]);
    expect(facts).toEqual({ homepage_url: undefined, naver_place_url: "https://m.place.naver.com/place/9" });
  });

  it("플레이스 소스가 없으면 아무것도 확정하지 않는다", () => {
    expect(structuredFactsFromSources([{ url: "http://bbdrive.co.kr/", text: "수강료 680,010원" }])).toEqual({});
  });
});

describe("limitPerHost — 한 사이트가 후보 자리를 독식하지 않게", () => {
  it("호스트당 개수를 제한하고 순서는 유지한다", () => {
    const urls = [
      "http://bbdrive.co.kr/",
      "http://bbdrive.co.kr/bbs/board.php?bo_table=08",
      "http://bbdrive.co.kr/bbs/board.php?bo_table=0203",
      "https://blog.naver.com/a/1",
    ];
    expect(limitPerHost(urls)).toEqual([
      "http://bbdrive.co.kr/",
      "http://bbdrive.co.kr/bbs/board.php?bo_table=08",
      "https://blog.naver.com/a/1",
    ]);
  });

  it("www 유무는 같은 사이트로 본다", () => {
    // 실측: bbdrive.co.kr 와 www.bbdrive.co.kr 가 두 자리를 차지해 같은 본문이 두 번 들어갔다.
    expect(limitPerHost(["http://www.bbdrive.co.kr/", "http://bbdrive.co.kr/", "https://blog.naver.com/a/1"]))
      .toEqual(["http://www.bbdrive.co.kr/", "https://blog.naver.com/a/1"]);
  });
});
