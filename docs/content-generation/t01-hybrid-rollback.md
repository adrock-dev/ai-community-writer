# T01 Hybrid Rollback

`t01_hybrid_v1`은 명시적 generation mode일 때만 실행된다. mode를 생략하거나 `legacy`를 보내면 기존 legacy 경로가 그대로 사용되고, `t01_data_gated_v2`도 기존 v2 경로를 사용한다.

롤백은 hybrid mode 호출을 중단하는 것으로 충분하다. DB schema/data migration, provider 변경, 관리자 기본값 변경, 비T01 rollback은 필요 없다.
