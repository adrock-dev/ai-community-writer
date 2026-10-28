// 생성 삽화의 장면. 장면을 통째로 두지 않고 피사체 × 장소 × 시점 × 빛·날씨로 나눠 글마다 조합한다.
// 장면이 고정돼 있으면 같은 유형 글마다 거의 같은 삽화가 나와서(2026-10-28), 유형마다 피사체를 여럿 두고
// 장소·시점·빛도 같은 유형 최근 글에 쓰지 않은 것부터 고른다. 색감은 글마다 하나로 맞춘다.
// 어울리지 않는 조합(지하주차장 + 노을, 차 안 + 위에서 내려다본 시점)을 막으려고 피사체마다 갈래(kind)를
// 정하고, 갈래가 장소·시점을, 장소가 빛(실외·실내·실내 주차장)을 정한다. 장소가 정해진 피사체는 place 로 고정한다.
// 실제 장소·업체를 흉내 내지 않는 일반적인 장면만 둔다. 실내운전연습장 시뮬레이터처럼
// 실제 장비와 다르게 보일 수 있는 장면은 넣지 않는다. 드라이빙존 글도 본문 이미지는 이 삽화로 채우고,
// 실제 매장 사진은 드라이빙존 안내 섹션에만 쓴다(비용·추천 글은 예외 — facts.ts drivingzonePhotos).

/** 도로(차 밖) · 주차 · 시험 코스 · 차 안 · 실내 공간 · 탁자 위 */
type Kind = "road" | "parking" | "course" | "cabin" | "room" | "desk";

/** 장소마다 어울리는 빛 목록. 지하주차장에 창 햇살이 붙지 않게 주차장 실내는 따로 둔다. */
type Light = "outdoor" | "indoor" | "garage";

interface Place {
  name: string;
  light: Light;
}

interface Subject {
  text: string;
  kind: Kind;
  /** 피사체에 장소가 딸려 있으면 고정한다(예: 강의실 수강생) */
  place?: Place;
}

const out = (name: string): Place => ({ name, light: "outdoor" });
const inside = (name: string): Place => ({ name, light: "indoor" });
const garage = (name: string): Place => ({ name, light: "garage" });

const PLACES: Record<Kind, Place[]> = {
  road: [
    out("가로수가 늘어선 2차로 도로"),
    out("한적한 주택가 골목"),
    out("신호등이 있는 도심 교차로"),
    out("강을 따라 난 강변 도로"),
    out("횡단보도가 있는 시내 도로"),
    out("상가가 늘어선 시내 도로"),
    out("완만한 언덕길"),
    out("교외의 넓은 4차로 도로"),
    out("학교 앞 어린이 보호구역 도로"),
    out("고가도로 아래 넓은 도로"),
  ],
  parking: [
    garage("아파트 지하주차장"),
    garage("기둥이 많은 건물 실내 주차장"),
    out("대형마트 야외 주차장"),
    out("주택가 공영주차장"),
    out("넓은 공터"),
    out("도로 옆 평행 주차 구간"),
  ],
  course: [
    out("흰 차선과 라바콘이 놓인 넓은 아스팔트 연습 코스"),
    out("연습 코스의 긴 직선 구간"),
    out("연습 코스 출발선 부근"),
    out("잔디와 낮은 울타리로 둘러싸인 연습 코스 가장자리"),
  ],
  cabin: [
    out("앞유리 너머로 시내 도로가 보이는 차 안"),
    out("앞유리 너머로 주택가 골목이 보이는 차 안"),
    out("앞유리 너머로 교차로 신호등이 보이는 차 안"),
    out("앞유리 너머로 한적한 교외 도로가 보이는 차 안"),
    out("앞유리 너머로 주차장이 보이는 차 안"),
  ],
  room: [
    inside("밝은 민원실"),
    inside("깔끔한 상담실"),
    inside("창이 넓은 대기실"),
    inside("단정한 사무 공간"),
  ],
  desk: [
    inside("밝은 원목 책상 위"),
    inside("카페 창가 테이블 위"),
    inside("거실 낮은 탁자 위"),
    inside("흰 사무용 책상 위"),
  ],
};

const VIEWS: Record<Kind, string[]> = {
  road: [
    "측면 시점",
    "뒤쪽 높은 시점",
    "멀리서 본 넓은 시점",
    "앞쪽에서 비스듬히 본 시점",
    "높은 곳에서 내려다본 시점",
    "보행자 눈높이 시점",
  ],
  parking: ["위에서 내려다본 시점", "차량 뒤쪽 시점", "측면 시점", "주차 칸 끝에서 본 시점"],
  course: [
    "측면 시점",
    "높은 곳에서 내려다본 시점",
    "출발선 쪽에서 본 시점",
    "멀리서 본 넓은 시점",
  ],
  cabin: [
    "운전석 어깨 너머 시점",
    "뒷좌석에서 앞을 본 시점",
    "보조석에서 본 시점",
    "손 위주 클로즈업",
  ],
  room: ["입구 쪽에서 본 넓은 시점", "뒤쪽에서 본 시점", "비스듬한 눈높이 시점"],
  desk: ["위에서 내려다본 시점", "비스듬한 클로즈업", "눈높이 측면 시점"],
};

const LIGHTS: Record<Light, string[]> = {
  outdoor: [
    "맑은 오전 햇살",
    "따뜻한 늦은 오후 햇빛",
    "흐린 날의 부드러운 빛",
    "비 온 뒤 젖은 노면과 갠 하늘",
    "해 질 녘 노을빛",
    "이른 아침의 옅은 안개",
    "가로등이 막 켜진 초저녁",
    "구름이 조금 낀 한낮",
  ],
  indoor: [
    "창으로 들어오는 아침 햇살",
    "오후 햇빛이 비스듬히 드는 실내",
    "밝고 고른 실내 조명",
    "은은하고 따뜻한 조명",
    "흐린 날 창가의 부드러운 빛",
  ],
  garage: [
    "밝고 고른 천장 조명",
    "따뜻한 노란빛 천장 조명",
    "바닥 주차선이 또렷한 하얀 조명",
    "출입구 쪽에서 들어오는 바깥 빛",
  ],
};

/** 글마다 하나로 맞추는 색감 */
const TONES = [
  "밝고 산뜻한 색감",
  "선명하고 맑은 색감",
  "은은하고 따뜻한 색감",
  "차분하고 부드러운 색감",
  "채도가 낮은 담백한 색감",
];

const s = (text: string, kind: Kind, place?: Place): Subject => ({ text, kind, place });

const DRIVING = [
  s("출발 전 안전벨트를 매는 손과 계기판", "cabin"),
  s("천천히 달리는 소형 승용차", "road"),
  s("앞차와 간격을 두고 달리는 승용차", "road"),
  s("룸미러로 뒤를 확인하는 운전자의 눈높이, 얼굴은 보이지 않게", "cabin"),
  s("핸들을 두 손으로 잡은 운전자의 뒷모습", "cabin"),
  s("방향지시등을 켜고 차선을 바꾸는 승용차", "road"),
  s("교차로에서 신호를 기다리는 승용차 두 대", "road"),
  s("주차 칸에 반듯하게 세워진 승용차", "parking"),
];

const ACADEMY = [
  s("줄지어 선 연습용 승용차 여러 대", "course"),
  s("교육을 듣는 수강생들의 뒷모습", "room", inside("밝은 강의실")),
  s("출발선에 선 승용차와 옆에서 안내하는 강사의 뒷모습", "course"),
  s("안내 책자와 펜, 마주 앉은 두 사람의 손", "room", inside("깔끔한 상담실")),
  s("주차된 연습용 승용차 옆을 걸어가는 수강생의 뒷모습", "course"),
  s("라바콘 사이를 천천히 지나는 연습용 승용차", "course"),
  s("상담 순서를 기다리는 사람들의 뒷모습", "room"),
  s("연습용 승용차 보조석에 앉은 강사의 손과 운전대를 잡은 수강생의 손", "cabin"),
];

const SUBJECTS: Record<string, Subject[]> = {
  exam: [
    s("주행 연습 구간을 달리는 승용차", "course"),
    s("펼쳐진 교재와 노트, 연필과 자동차 키", "desk"),
    s("경사로 구간을 오르는 승용차", "course"),
    s("도로주행 시험 경로를 달리는 승용차", "road"),
    s("태블릿으로 문제를 풀며 공부하는 손과 커피잔", "desk"),
    s("차량 옆에서 시험을 기다리는 응시자의 뒷모습", "course"),
    s("오답 노트에 표시하는 손과 형광펜", "desk"),
    s("T자 주차 구간에 차를 맞추는 승용차", "course"),
    s("횡단보도 앞 정지선에 멈춘 승용차", "road"),
  ],
  test_center: [
    s("넓은 주차장과 대기 중인 연습용 승용차, 낮은 공공기관 건물", "parking"),
    s("창구와 대기 의자", "room"),
    s("공공기관 건물 입구로 이어지는 넓은 보행로와 화단", "road"),
    s("코스를 바라보는 사람들의 뒷모습", "course"),
    s("정류장에서 버스를 기다리는 사람의 뒷모습", "road"),
    s("번호표를 들고 대기 의자에 앉은 사람의 손", "room"),
    s("안내 표지판이 있는 건물 복도를 걸어가는 사람의 뒷모습, 표지판 글자는 흐리게", "room"),
  ],
  license_admin: [
    s("카드 지갑, 증명사진 봉투, 서류 파일", "desk"),
    s("번호표 발권기와 대기 의자", "room"),
    s("서류를 작성하는 손과 볼펜", "desk"),
    s("시력 검사표 앞에 선 사람의 뒷모습", "room", inside("밝은 검사실")),
    s("달력에 날짜를 표시하는 손과 카드 지갑", "desk"),
    s("스마트폰으로 예약 화면을 보는 손, 화면 글자는 흐리게", "desk"),
    s("창구 앞에서 서류를 건네는 두 사람의 손", "room"),
  ],
  howto: [
    ...DRIVING.slice(0, 1),
    s("도로 옆에 세운 승용차와 보조석에서 방향을 가리키는 손", "cabin"),
    s("운전석 시트 위치를 조절하는 손", "cabin"),
    s("방향지시등 레버를 내리는 손", "cabin"),
    s("사이드미러를 보는 운전자의 어깨", "cabin"),
    s("비상등을 켜고 갓길에 정차한 승용차", "road"),
    s("기어를 주행으로 옮기는 손", "cabin"),
    s("천천히 우회전하는 승용차", "road"),
  ],
  guide: DRIVING,
  tips: [
    s("정지선 앞에서 신호를 기다리며 핸들을 잡은 두 손", "cabin"),
    s("T자 주차 구간에 들어서는 승용차", "course"),
    s("횡단보도 앞에서 서행하는 승용차", "road"),
    s("평행 주차 구간에 차를 맞추는 승용차", "parking"),
    s("천천히 달리는 승용차", "road"),
    s("라바콘 사이로 방향을 트는 승용차", "course"),
    s("후진하며 뒤를 돌아보는 운전자의 어깨", "cabin"),
    s("안전거리를 두고 앞차를 따라가는 승용차", "road"),
  ],
  training: [
    s("핸들을 잡은 초보 운전자의 뒷모습과 보조석에서 조언하는 강사의 손", "cabin"),
    s("후진 주차를 연습하는 소형 승용차", "parking"),
    s("앞 도로를 가리키며 설명하는 강사의 손", "cabin"),
    s("천천히 지나는 소형 승용차", "road"),
    s("주차 칸에 차를 맞추는 승용차", "parking"),
    s("합류 구간으로 진입하는 승용차", "road", out("고속도로 합류 구간")),
    s("좌회전 신호를 기다리며 핸들을 잡은 손", "cabin"),
    s("오랜만에 운전석에 앉아 시동 버튼을 누르는 손", "cabin"),
    s("천천히 원을 그리며 연습하는 소형 승용차", "parking", out("넓은 공터")),
    s("고개를 돌려 사각지대를 확인하는 운전자의 뒷모습", "cabin"),
    s("차선을 바꾸는 소형 승용차", "road"),
    s("좁은 길에서 마주 오는 차에 길을 비켜 주는 소형 승용차", "road"),
    s("출차하며 천천히 빠져나가는 소형 승용차", "parking"),
    s("초보 운전 차량 뒤를 간격을 두고 따라가는 승용차", "road"),
  ],
  parking: [
    s("후진 주차를 연습하는 소형 승용차", "parking"),
    s("주차 칸에 차를 맞추는 승용차", "parking"),
    s("후진하며 뒤를 돌아보는 운전자의 어깨", "cabin"),
    s("사이드미러에 비친 주차선", "cabin"),
    s("평행 주차 구간에 차를 맞추는 승용차", "parking"),
    s("출차하며 천천히 빠져나가는 소형 승용차", "parking"),
    s("나란히 선 두 차 사이 빈 칸으로 들어가는 소형 승용차", "parking"),
    s("주차를 마치고 핸들을 바로 하는 손", "cabin"),
  ],
  road_skill: [
    s("차선을 바꾸는 소형 승용차", "road"),
    s("합류 구간으로 진입하는 승용차", "road", out("고속도로 합류 구간")),
    s("고개를 돌려 사각지대를 확인하는 운전자의 뒷모습", "cabin"),
    s("좌회전 신호를 기다리며 핸들을 잡은 손", "cabin"),
    s("방향지시등 레버를 내리는 손", "cabin"),
    s("안전거리를 두고 앞차를 따라가는 승용차", "road"),
    s("회전교차로를 천천히 도는 승용차", "road"),
    s("사이드미러를 보는 운전자의 어깨", "cabin"),
  ],
  training_fear: [
    s("오랜만에 운전석에 앉아 시동 버튼을 누르는 손", "cabin"),
    s("핸들 위에 가볍게 올린 두 손", "cabin"),
    s("천천히 원을 그리며 연습하는 소형 승용차", "parking", out("넓은 공터")),
    s("한적한 길을 천천히 지나는 소형 승용차", "road"),
    s("보조석에서 앞을 가리키며 설명하는 손", "cabin"),
    s("자동차 키와 노트", "desk", inside("도로가 내다보이는 카페 창가 테이블 위")),
    s("주차를 마치고 차에서 내리는 사람의 뒷모습", "parking"),
  ],
  training_course: [
    s("핸들을 잡은 초보 운전자의 뒷모습과 보조석에서 조언하는 강사의 손", "cabin"),
    s("달력에 연습 날짜를 표시하는 손과 자동차 키", "desk"),
    s("앞 도로를 가리키며 설명하는 강사의 손", "cabin"),
    s("노트에 표를 그리며 비교하는 손과 볼펜", "desk"),
    s("상담 테이블에 마주 앉은 두 사람의 손", "room", inside("깔끔한 상담실")),
    s("천천히 지나는 소형 승용차", "road"),
    s("스마트폰으로 일정을 확인하는 손과 자동차 키", "desk"),
  ],
  cost: [
    s("계산기, 자동차 키, 메모지", "desk"),
    s("안내 책자와 펜, 사람 손", "desk"),
    s("노트에 표를 그리며 비교하는 손과 볼펜", "desk"),
    s("스마트폰으로 일정을 확인하는 손과 자동차 키", "desk"),
    s("돼지 저금통과 자동차 키", "desk"),
    s("영수증 몇 장과 카드 지갑, 글자는 흐리게", "desk"),
    s("상담 테이블에 마주 앉은 두 사람의 손", "room", inside("깔끔한 상담실")),
  ],
  recommend: ACADEMY,
  academy: ACADEMY,
  license_type: [
    s("나란히 주차된 소형 승용차와 1톤 트럭", "parking"),
    s("자동 변속기 레버와 수동 변속기 레버", "cabin"),
    s("달리는 1톤 트럭", "road"),
    s("수동 변속기 레버를 잡은 손과 클러치 페달 쪽 발", "cabin"),
    s("작은 스쿠터와 승용차", "parking"),
    s("나란히 선 소형 승합차와 승용차", "parking"),
    s("짐을 싣고 천천히 달리는 소형 트럭", "road"),
  ],
  review: [
    s("핸들을 잡고 앞을 보는 운전자의 뒷모습", "cabin"),
    s("달리는 소형 승용차", "road"),
    s("주차를 마치고 차에서 내리는 사람의 뒷모습", "parking"),
    s("자동차 키와 노트", "desk", inside("도로가 내다보이는 카페 창가 테이블 위")),
    s("멀어지는 승용차", "road"),
    s("조수석에 놓인 가방과 앞유리 너머 도로", "cabin"),
    s("주차장에 세운 차 옆에서 키를 든 손", "parking"),
  ],
};

/** 장면 설명의 각 요소 이름. 장면 문자열에서 요소를 다시 읽을 때도 쓴다. */
const LABELS = { place: "장소", view: "시점", light: "빛·날씨", tone: "색감" } as const;
type Part = keyof typeof LABELS;

export function subjectPool(articleType: string): string[] {
  return (SUBJECTS[articleType] ?? SUBJECTS.guide!).map((x) => x.text);
}

/** 장면 설명 → 피사체와 요소들. 예전 형식(통째 장면)은 피사체만 있다. */
function parseScene(scene: string): { subject: string } & Partial<Record<Part, string>> {
  const [subject = "", ...rest] = scene.split(". ");
  const parts: Partial<Record<Part, string>> = {};
  for (const r of rest) {
    for (const [part, label] of Object.entries(LABELS) as [Part, string][]) {
      if (r.startsWith(`${label}: `)) parts[part] = r.slice(label.length + 2);
    }
  }
  return { subject, ...parts };
}

/**
 * 후보를 최근에 안 쓴 것 → 오래전에 쓴 것 순으로 늘어놓는다. used 는 최신 순이고, 같은 순위는 무작위.
 * taken(이 글에서 이미 고른 것)은 맨 뒤로 보낸다.
 */
function rank<T>(
  items: T[],
  key: (x: T) => string,
  used: (string | undefined)[],
  random: () => number,
  taken: Set<string> = new Set(),
): T[] {
  return items
    .map((item) => {
      const k = key(item);
      const i = used.indexOf(k);
      return {
        item,
        age: taken.has(k) ? -1 : i < 0 ? Number.POSITIVE_INFINITY : i,
        order: random(),
      };
    })
    .sort((a, b) => (a.age === b.age ? a.order - b.order : b.age - a.age))
    .map((x) => x.item);
}

/**
 * 글에 쓸 장면을 고른다. recent 는 같은 유형의 최근 글에 쓴 삽화 장면(최신 순)이다.
 * 피사체는 쓴 적 없는 것 → 오래전에 쓴 것 순으로, 장소·시점·빛도 같은 방식으로 고르고
 * 한 글 안에서는 겹치지 않게 한다. 색감은 글마다 하나다.
 */
export function pickScenes(
  articleType: string,
  count: number,
  recent: string[],
  random: () => number,
): string[] {
  const past = recent.map(parseScene);
  const usedOf = (part: Part) => past.map((p) => p[part]);
  const id = (x: string) => x;
  const tone = rank(TONES, id, usedOf("tone"), random)[0]!;
  const subjects = rank(
    SUBJECTS[articleType] ?? SUBJECTS.guide!,
    (x) => x.text,
    past.map((p) => p.subject),
    random,
  ).slice(0, Math.max(0, count));
  const taken: Record<Exclude<Part, "tone">, Set<string>> = {
    place: new Set(),
    view: new Set(),
    light: new Set(),
  };
  return subjects.map((subject) => {
    const place =
      subject.place ??
      rank(PLACES[subject.kind], (p) => p.name, usedOf("place"), random, taken.place)[0]!;
    const view = rank(VIEWS[subject.kind], id, usedOf("view"), random, taken.view)[0]!;
    const light = rank(LIGHTS[place.light], id, usedOf("light"), random, taken.light)[0]!;
    taken.place.add(place.name);
    taken.view.add(view);
    taken.light.add(light);
    return [
      subject.text,
      `${LABELS.place}: ${place.name}`,
      `${LABELS.view}: ${view}`,
      `${LABELS.light}: ${light}`,
      `${LABELS.tone}: ${tone}`,
    ].join(". ");
  });
}
