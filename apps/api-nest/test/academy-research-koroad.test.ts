import { describe, expect, it } from "vitest";
import {
  addressKey,
  isKoroadTestCoursePage,
  isTestCourseType,
  koroadBlockToSource,
  matchKoroadBlock,
  parseKoroadBlocks,
  type KoroadBlock,
} from "../src/academy-research-koroad.js";
import { cleanParkingNote, shortenTransit } from "../src/academy-research-article-fields.js";

// 도로교통공단 「지방조직찾기」 페이지의 실제 구조를 줄인 것. 우편번호 표기가 블록마다
// 다르고(`(57764)` / `(우편번호:…)` / `(우 : …)` / 없음), 주소 뒤에 시험장 이름이 덧붙는
// 블록이 있다 — 실제 페이지에서 매칭을 깨뜨린 것들이라 그대로 남겨 둔다.
const PAGE = `
<div class="wrap">
<div class="mapCont cate77">
  <div class="tit">부산 운전면허시험장</div>
  <h3 class="subTit">주소 및 연락처</h3>
  <dl><dt>주소</dt><dd><ul><li>(48518) 부산광역시 남구 용호로 16(용호동 산 45-3번지) 남부운전면허시험장</li>
  <li>16, Yongho-ro, Nam-gu, Busan</li></ul></dd>
  <dt>연락처(call)</dt><dd>1577-1120</dd>
  <dt>팩스(fax)</dt><dd>(051)626-7440</dd></dl>
  <dl><dt>대중교통을 이용하여 오시는 길</dt><dd><ul><li>지하철 2호선 경성대·부경대역 하차</li></ul></dd></dl>
  <div class="alarmText"><p>&#8251; 주의사항</p><ul><li>주차공간이 협소합니다.</li></ul></div>
</div>
<div class="mapCont cate78">
  <div class="tit">부산북부 운전면허시험장</div>
  <dl><dt>주소</dt><dd><ul><li>(우편번호:46946) 부산광역시 사상구 사상로 367번길 35</li></ul></dd>
  <dt>연락처(call)</dt><dd>1577-1120</dd>
  <dt>팩스(fax)</dt><dd>070-8211-2350</dd></dl>
  <dl><dt>대중교통을 이용하여 오시는 길</dt><dd><ul><li>지하철 2호선 감전역 하차</li></ul></dd></dl>
  <div class="alarmText"><p>&#8251; 주의사항</p><ul><li>내비게이션은 부산북부운전면허시험장으로 검색하세요.</li></ul></div>
</div>
<div class="mapCont cate93">
  <div class="tit">전남 운전면허시험장</div>
  <dl><dt>주소</dt><dd><ul><li>(58263) 전남광주 나주시 내영산2길 49번지(삼영동 189번지)</li></ul></dd>
  <dt>연락처(call)</dt><dd>1577-1120</dd>
  <dt>팩스(fax)</dt><dd>(061)339-1580</dd></dl>
</div>
</div>
<footer><div class="mapCont cate99"><div class="tit">푸터에 섞인 것</div></div></footer>
`;

describe("시험장 전용 소스 — 공단 페이지 파싱", () => {
  const blocks = parseKoroadBlocks(PAGE);

  it("시험장별 블록으로 갈리고, 푸터는 마지막 블록에 딸려오지 않는다", () => {
    expect(blocks.map((b) => b.cate)).toEqual(["77", "78", "93"]);
    expect(blocks.at(-1)!.name).toBe("전남 운전면허시험장");
  });

  it("우편번호 표기가 제각각이어도 주소·연락처·팩스를 라벨 기준으로 집는다", () => {
    const busan = blocks[0]!;
    expect(busan.address).toContain("부산광역시 남구 용호로 16");
    expect(busan.tel).toBe("1577-1120");
    expect(busan.fax).toBe("(051)626-7440");
    expect(blocks[1]!.address).toContain("사상로 367번길 35");
  });

  it("대중교통 경로와 주의사항을 서로 섞지 않는다", () => {
    expect(blocks[0]!.transit.join(" ")).toContain("경성대");
    expect(blocks[0]!.transit.join(" ")).not.toContain("주차공간");
    expect(blocks[0]!.cautions.join(" ")).toContain("주차공간");
  });
});

describe("시험장 전용 소스 — 우리 DB 학원과 매칭", () => {
  const blocks = parseKoroadBlocks(PAGE);

  it("블록 이름이 우리 이름과 달라도 주소로 찾는다", () => {
    // 공단은 "부산", 우리 원천은 "부산 남부".
    const hit = matchKoroadBlock(blocks, { name: "부산 남부 운전면허시험장", address: "부산광역시 남구 용호로 16" });
    expect(hit?.cate).toBe("77");
  });

  it("남부·북부가 같은 블록을 가져가지 않는다", () => {
    const south = matchKoroadBlock(blocks, { name: "부산 남부 운전면허시험장", address: "부산광역시 남구 용호로 16" });
    const north = matchKoroadBlock(blocks, { name: "부산 북부 운전면허시험장", address: "부산광역시 사상구 사상로367번길 35" });
    expect(south?.cate).toBe("77");
    expect(north?.cate).toBe("78");
  });

  it("시·도 표기가 갈려도 매칭된다", () => {
    // 원천 "전라남도 나주시" vs 공단 "전남광주 나주시".
    const hit = matchKoroadBlock(blocks, { name: "전남 운전면허시험장", address: "전라남도 나주시 내영산2길 49" });
    expect(hit?.cate).toBe("93");
  });

  it("근거가 없으면 매칭하지 않는다 — 엉뚱한 시험장 자료를 주입하느니 비운다", () => {
    expect(matchKoroadBlock(blocks, { name: "대구 운전면허시험장", address: "대구광역시 북구 태암남로 38" })).toBeNull();
    expect(matchKoroadBlock(blocks, { name: "", address: "" })).toBeNull();
  });

  it("이름 부분일치로는 매칭하지 않는다", () => {
    // "부산"이 이름에 들어간다는 이유만으로 cate77 을 가져가면 안 된다.
    expect(matchKoroadBlock(blocks, { name: "부산 동래 운전면허시험장", address: "부산광역시 동래구 없는로 1" })).toBeNull();
  });
});

describe("시험장 전용 소스 — 주소 키", () => {
  it("주소 뒤에 붙은 시험장 이름이 키를 흔들지 않는다", () => {
    expect(addressKey("(48518) 부산광역시 남구 용호로 16(용호동 산 45-3번지) 남부운전면허시험장"))
      .toBe(addressKey("부산광역시 남구 용호로 16"));
  });

  it("번길·공백 표기 차이를 흡수한다", () => {
    expect(addressKey("부산광역시 사상구 사상로 367번길 35")).toBe(addressKey("부산광역시 사상구 사상로367번길 35"));
  });

  it("주소가 없으면 빈 키다 — 빈 키끼리 매칭되면 안 된다", () => {
    expect(addressKey("")).toBe("");
    expect(addressKey(null)).toBe("");
  });
});

describe("시험장 전용 소스 — 소스 변환", () => {
  it("본문에 시험장 이름·주소·교통·주의사항이 담긴다", () => {
    const block: KoroadBlock = {
      cate: "94", name: "광양 운전면허시험장", address: "(57764)전남 광양시 광양읍 대학로 11",
      tel: "1577-1120", fax: "(061) 760-1660",
      transit: ["광양터미널 정류장에서 77번 승차"], cautions: ["주차공간이 매우 협소합니다."],
    };
    const source = koroadBlockToSource(block);
    expect(source.url).toContain("bcstIdx2=94");
    expect(source.text).toContain("광양 운전면허시험장");
    expect(source.text).toContain("대학로 11");
    expect(source.text).toContain("77번 승차");
    expect(source.text).toContain("주차공간");
  });
});

describe("시험장 전용 소스 — 적용 대상", () => {
  it("시험장·면허센터에만 적용한다", () => {
    expect(isTestCourseType("license_test_course")).toBe(true);
    expect(isTestCourseType("license_center")).toBe(true);
    expect(isTestCourseType("exam_academy")).toBe(false);
    expect(isTestCourseType(null)).toBe(false);
  });

  it("이미 통째로 받은 공단 페이지는 후보에서 걸러 자리를 낭비하지 않는다", () => {
    expect(isKoroadTestCoursePage("https://www.koroad.or.kr/main/content/view/MN05010523.do?bcstIdx1=69&bcstIdx2=94")).toBe(true);
    // 공단의 다른 페이지(공지·민원)는 별개 근거라 남긴다.
    expect(isKoroadTestCoursePage("https://www.koroad.or.kr/main/board/9/board_list.do?bcstIdx1=68")).toBe(false);
    expect(isKoroadTestCoursePage("https://www.safedriving.or.kr/mainM.do")).toBe(false);
    // 다른 도메인이 경로에 문자열만 흉내 내는 경우.
    expect(isKoroadTestCoursePage("https://example.com/koroad.or.kr/MN05010523.do")).toBe(false);
  });
});

describe("대중교통 경로 줄이기", () => {
  it("짧은 값은 그대로 둔다", () => {
    expect(shortenTransit("지하철 2호선 감전역 하차")).toBe("지하철 2호선 감전역 하차");
  });

  it("경로가 여럿 나열되면 첫 경로만 남긴다", () => {
    // 광양 실제 값(494자)을 줄인 형태.
    const value = "광양공영버스 터미널에서 광양터미널 정류장까지 약 60m 이동->77(광양역.제일고), 777 승차 후, 한려대학교 정류장에서 하차->광양운전면허시험장까지 약 216m 도보 이동=> 약 25분 소요. 순천종합버스 터미널에서 종합버스터미널 정류장까지 약 105m이동->77 승차 후 하차 => 약 40분 소요";
    const short = shortenTransit(value);
    expect(short.length).toBeLessThanOrEqual(140);
    expect(short).toContain("광양공영버스 터미널에서");
    expect(short).not.toContain("순천종합버스");
  });

  it("끊을 자리가 없으면 길이로 자른다", () => {
    const value = "가".repeat(400);
    const short = shortenTransit(value);
    expect(short.length).toBeLessThanOrEqual(141);
    expect(short.endsWith("…")).toBe(true);
  });
});

describe("주차 안내 정형구 걷어내기", () => {
  it("공단이 전 시험장에 붙인 문장만 있으면 글에 내보내지 않는다", () => {
    expect(cleanParkingNote("주차공간이 매우 협소하오니 가급적 대중교통을 이용해 주시기 바랍니다.")).toBe("");
  });

  it("정형구 뒤의 실제 주차 사정은 남긴다", () => {
    // 강서 실제 값 — 앞뒤가 모순이라(협소 vs 무료 200대) 정형구를 걷어내야 사실이 드러난다.
    const value = "주차공간이 매우 협소하오니 가급적 대중교통을 이용해 주시기 바랍니다. 강서운전면허시험장은 무료 주차가 가능합니다. 주차용량 : 200대.";
    const cleaned = cleanParkingNote(value);
    expect(cleaned).not.toContain("매우 협소");
    expect(cleaned).toContain("무료 주차가 가능");
    expect(cleaned).toContain("200대");
  });

  it("정형구가 없는 값은 손대지 않는다", () => {
    expect(cleanParkingNote("주차장 무료이용")).toBe("주차장 무료이용");
  });
});
