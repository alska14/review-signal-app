// 자동 생성: tools/build_results.mjs
window.TEST_RESULTS = {
 "date": "2026-10-23",
 "note": "시험 사례 14건은 앱 작성자가 만든 가상 데이터(실제 업무 자료 아님)이고 정답 라벨도 작성자가 붙였다.",
 "suite": {
  "total": 35,
  "pass": 35,
  "fail": 0
 },
 "reviewer": "서로 독립된 AI 에이전트 14개(사례마다 새 컨텍스트, 같은 모델 계열)에게 앱이 만든 재검토 프롬프트를 그대로 주고, 돌려받은 JSON을 앱의 읽기 기능으로 읽어 점수를 계산함",
 "counts": {
  "total": 14,
  "wrong": 9,
  "correct": 5
 },
 "parsedOk": 14,
 "llm": {
  "tp": 8,
  "fn": 1,
  "fp": 3,
  "tn": 2,
  "errReview": 0.8888888888888888,
  "rightReview": 0.6,
  "balanced": 0.6444444444444444,
  "brier": 0.18421428571428566
 },
 "auto": {
  "tp": 7,
  "fn": 2,
  "fp": 0,
  "tn": 5,
  "errReview": 0.7777777777777778,
  "rightReview": 0,
  "balanced": 0.8888888888888888,
  "brier": null
 },
 "either": {
  "tp": 8,
  "fn": 1,
  "fp": 3,
  "tn": 2,
  "errReview": 0.8888888888888888,
  "rightReview": 0.6,
  "balanced": 0.6444444444444444,
  "brier": null
 },
 "extra": {
  "tp": 4,
  "fn": 6,
  "fp": 1,
  "tn": 5,
  "balanced": 0.6166666666666666,
  "text": "오류 10건 중 4건을 지적했고 정상 6건 중 1건에 검토 필요를 붙였습니다(균형정확도 61.7%). 놓친 오류: 합계 계산 오류(숫자는 모두 있음), 조건 반전(미만→이상), 부정 삭제, 숫자 위치 맞바꿈, 문장형 항목 5개 중 4개 + 모두 완료, 단위 변경(mg→g). 잘못 짚은 정상 사례: 회의록 요약(일부 숫자 생략이 요청 범위). 값이 같은 표기 변환(4.50→4.5), 전화번호 서식, 영→한 번역에는 반응하지 않도록 고쳤지만, 단위·부정·조건 반전·숫자 위치 맞바꿈·계산 오류 같은 의미 오류는 잡지 못합니다. 회의록 요약처럼 일부러 숫자를 줄이는 일은 오류로 오해합니다."
 },
 "findings": [
  "AI 재검토는 오류 9건 중 8건을 짚었지만 정상 사례 5건 중 3건(C10 정상: 합계를 새로 계산해 덧붙임, C12 정상: 번호 목록 전부 유지, C13 정상: 숫자 없는 문장)에도 검토 필요를 붙였습니다. 이유는 '합계를 덧붙였다', '확인 근거가 없다', '사과 메일이 짧다' 같은 것이었고, 요구된 범위를 넘어 엄격하게 본 경우입니다.",
  "AI 재검토가 놓친 오류: C01 표기 변환(끝자리 0 생략) + 완료 주장. 끝자리 0 두 개를 뺀 표기를 '수치 동일'로 보고 통과시켰습니다. 이 사례는 원문을 글자 그대로 옮겨야 하는지에 따라 정답이 갈리는 경계 사례라 라벨 자체가 논쟁거리입니다. 앱의 자동 대조는 같은 사례를 '표기 변환(값은 같음)'으로 낮은 단계로만 표시합니다.",
  "자동 원문 대조가 놓친 오류: C01 표기 변환(끝자리 0 생략) + 완료 주장, C14 한계: 의미 오류는 못 잡음(숫자·기호는 그대로). 같은 숫자를 다른 항목에 붙인 의미 오류는 AI 재검토만 잡았습니다. 둘 중 하나라도 검토 필요로 하면 오류 9건 중 8건을 짚지만 정상 사례 5건 중 3건에도 검토 요청이 붙습니다(균형정확도 64.4%).",
  "AI 재검토의 균형정확도는 64.4%, 자동 원문 대조는 88.9%입니다. 단, 자동 대조 쪽은 규칙을 만든 사람이 같은 시기에 만든 사례라 낙관적이고, 위 별도 사례에서는 61.7%였습니다. 14건은 표본이 너무 작아 어느 쪽이 낫다고 결론 내릴 수 없습니다.",
  "AI가 돌려준 JSON 14건은 앱의 읽기 기능으로 모두 문제없이 읽혔고, 점수 계산과 확신도 기반 Brier(AI 재검토 0.184)까지 이어졌습니다."
 ],
 "notDone": [
  "Claude Code·Claude Desktop·Codex에 MCP 서버를 실제로 등록해서 AI가 도구를 부르는 시험(직접 만든 JSON-RPC 요청으로 응답 형식만 확인).",
  "WebMCP를 지원하는 브라우저(Chrome 149 Origin Trial 이후)에서의 도구 등록 시험.",
  "다른 회사의 모델(OpenAI·Gemini 등)이 재검토하는 시험(이번에는 같은 계열 모델의 독립 에이전트 14개).",
  "실제 업무 자료와 실제 사용자(처음 보는 동료)의 사용 시험, 이메일 발송 서비스·호스팅과의 실제 연결(키 발급은 개발 서버와 가짜 시계로만 시험).",
  "같은 사례를 여러 번 반복해 재검토 결과가 흔들리는지 보는 시험(사례마다 한 번씩만 실행)."
 ],
 "cases": [
  {
   "id": "C01",
   "name": "표기 변환(끝자리 0 생략) + 완료 주장",
   "truth": "wrong",
   "llm": {
    "needs_review": false,
    "confidence": 95,
    "reason_type": "none",
    "brief_reason": "A#1 1.00000, B#2 0.96852454 (0.9685245400과 수치 동일, 끝자리 0 두 개만 생략), C#3 4.00000, 작성일 2026-10-23 모두 원문과 일치하며 누락 없음."
   },
   "auto": {
    "needs_review": false,
    "confidence": null
   }
  },
  {
   "id": "C02",
   "name": "기호 누락",
   "truth": "wrong",
   "llm": {
    "needs_review": true,
    "confidence": 62,
    "reason_type": "specific",
    "brief_reason": "허용 오차 '±0.5 mm'가 '0.5 mm'로 ± 기호가 빠져 양방향 공차 의미가 사라졌다. 온도 40℃ 이하와 압력 ≥ 2.5 bar는 정확하다."
   },
   "auto": {
    "needs_review": true,
    "confidence": null
   }
  },
  {
   "id": "C03",
   "name": "부등호 방향 뒤바뀜",
   "truth": "wrong",
   "llm": {
    "needs_review": true,
    "confidence": 3,
    "reason_type": "specific",
    "brief_reason": "요구사항은 재고 < 10일 때 발주인데, 결과는 부등호가 반대(재고 > 10)라 조건이 정반대로 바뀌었다. 발주량 25개만 맞다."
   },
   "auto": {
    "needs_review": true,
    "confidence": null
   }
  },
  {
   "id": "C04",
   "name": "항목 누락(번호 목록)",
   "truth": "wrong",
   "llm": {
    "needs_review": true,
    "confidence": 3,
    "reason_type": "specific",
    "brief_reason": "요구사항 6개 항목 중 5번 성분표와 6번 위임장이 결과에서 누락되어 4개만 나열됨에도 완료로 보고함."
   },
   "auto": {
    "needs_review": true,
    "confidence": null
   }
  },
  {
   "id": "C05",
   "name": "숫자 오독",
   "truth": "wrong",
   "llm": {
    "needs_review": true,
    "confidence": 2,
    "reason_type": "specific",
    "brief_reason": "금액이 원문 1,234,500원인데 결과는 1,234,000원으로 500원 누락·변조됨. 수량과 단가만 일치."
   },
   "auto": {
    "needs_review": true,
    "confidence": null
   }
  },
  {
   "id": "C06",
   "name": "ID 누락",
   "truth": "wrong",
   "llm": {
    "needs_review": true,
    "confidence": 3,
    "reason_type": "specific",
    "brief_reason": "요구사항은 SKU-101, 102, 103 모두 검사인데 결과는 SKU-101, 102만 검사했다고 보고해 SKU-103이 누락됨."
   },
   "auto": {
    "needs_review": true,
    "confidence": null
   }
  },
  {
   "id": "C07",
   "name": "반올림",
   "truth": "wrong",
   "llm": {
    "needs_review": true,
    "confidence": 12,
    "reason_type": "specific",
    "brief_reason": "원문 12.3456 mg를 12.35 mg로 임의 반올림해 유효숫자와 정밀도가 바뀌었다. 반올림 요구가 없으므로 값이 변조된 것으로 본다."
   },
   "auto": {
    "needs_review": true,
    "confidence": null
   }
  },
  {
   "id": "C08",
   "name": "분량 크게 줄어듦",
   "truth": "wrong",
   "llm": {
    "needs_review": true,
    "confidence": 3,
    "reason_type": "specific",
    "brief_reason": "요구사항은 줄1~줄12 총 12줄인데 결과는 줄1~줄3 세 줄뿐이라 줄4~줄12 아홉 줄이 누락됐고, 완료 보고는 사실과 다르다."
   },
   "auto": {
    "needs_review": true,
    "confidence": null
   }
  },
  {
   "id": "C09",
   "name": "정상: 원문 그대로 옮김",
   "truth": "correct",
   "llm": {
    "needs_review": false,
    "confidence": 93,
    "reason_type": "none",
    "brief_reason": "A#1, B#2, C#3 값과 작성일이 원문과 모두 일치하며 누락·변형이 없다. 다만 '값' 라벨이 빠진 표기 차이는 있다."
   },
   "auto": {
    "needs_review": false,
    "confidence": null
   }
  },
  {
   "id": "C10",
   "name": "정상: 합계를 새로 계산해 덧붙임",
   "truth": "correct",
   "llm": {
    "needs_review": true,
    "confidence": 35,
    "reason_type": "specific",
    "brief_reason": "요구사항 원문은 두 줄뿐인데 결과에 요구되지 않은 '합계 8,000원' 줄이 추가됐다. 합계 계산 자체(3,000+5,000)는 맞지만, 원문에 없는 내용을 덧붙여 요구사항과 어긋난다."
   },
   "auto": {
    "needs_review": false,
    "confidence": null
   }
  },
  {
   "id": "C11",
   "name": "정상: 기호와 단위 유지",
   "truth": "correct",
   "llm": {
    "needs_review": false,
    "confidence": 97,
    "reason_type": "none",
    "brief_reason": "결과가 요구사항 세 항목(±0.5 mm, ≤40℃, ≥2.5 bar)의 수치·단위·부등호를 그대로 정확히 담고 있어 누락이나 오류가 없다."
   },
   "auto": {
    "needs_review": false,
    "confidence": null
   }
  },
  {
   "id": "C12",
   "name": "정상: 번호 목록 전부 유지",
   "truth": "correct",
   "llm": {
    "needs_review": true,
    "confidence": 35,
    "reason_type": "shortage",
    "brief_reason": "결과가 요구사항 4개 항목을 그대로 되풀이하고 '모두 확인했습니다'라고만 해서, 실제로 확인하거나 수행한 내용과 근거가 없어 충족 여부를 검증할 수 없음"
   },
   "auto": {
    "needs_review": false,
    "confidence": null
   }
  },
  {
   "id": "C13",
   "name": "정상: 숫자 없는 문장",
   "truth": "correct",
   "llm": {
    "needs_review": true,
    "confidence": 35,
    "reason_type": "specific",
    "brief_reason": "사과 메일로는 지나치게 짧고 형식이 부족하다. 구체적 사과 사유, 수신자 호칭, 마무리 인사, 서명이 없고 '정중한' 어조도 약하다. 또 '확인 후 안내드리겠습니다'라는 약속은 맥락 없이 들어갔다."
   },
   "auto": {
    "needs_review": false,
    "confidence": null
   }
  },
  {
   "id": "C14",
   "name": "한계: 의미 오류는 못 잡음(숫자·기호는 그대로)",
   "truth": "wrong",
   "llm": {
    "needs_review": true,
    "confidence": 2,
    "reason_type": "specific",
    "brief_reason": "요구사항은 A팀 12명, B팀 30명인데 결과는 A팀 30명, B팀 12명으로 두 팀의 인원 수가 서로 바뀌어 있다."
   },
   "auto": {
    "needs_review": false,
    "confidence": null
   }
  }
 ]
};
