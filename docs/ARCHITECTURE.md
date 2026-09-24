# 구조와 모듈 약속

빌드 없는 정적 사이트다. `index.html`이 import map으로 `three`를 `vendor/three/three.module.min.js`(0.185.1)에,
`three/addons/`를 `vendor/three/addons/`에 연결한다. 모든 경로는 상대 경로다(GitHub Pages가 `/<repo>/` 아래에서 서비스).

## 파일

| 파일 | 역할 | 의존 |
| --- | --- | --- |
| `js/rules.js` | 순수 규칙 엔진(이동·빽도·업기·잡기·던지기 확률·씨앗 난수) | 없음 |
| `js/ai.js` | 컴퓨터(쉬움·보통·어려움·살살) | rules |
| `js/party.js` | 잔치 칸, 가족 미션 | rules |
| `js/theme.js` | 팀 색 4개, 동물 8종, 결과→동물, 5음계 | 없음 |
| `js/anim.js` | tween/wait/ease, SPEED(움직임 줄이기면 0.55) | 없음 |
| `js/scene.js` | 렌더러·카메라·조명·그리기 루프·터치(ctx) | three, rules, anim |
| `js/layout.js` | 방석·완주 지점 좌표 | scene |
| `js/board.js` | 윷판·배경·방석·선택 표시(링·발자국) | scene, layout |
| `js/sticks.js` | 멍석과 윷가락, 던지기 연출 | scene, anim |
| `js/fx.js` | 색종이·폭죽·반짝이(InstancedMesh) | scene, anim |
| `js/characters.js` | 동물 말 리그·표정·연출 | scene, layout, theme, anim |
| `js/audio.js` | 합성 효과음·울음·장단, 진동 | theme |
| `js/voice.js` | 한국어 읽어 주기(speechSynthesis) | 없음 |
| `js/game.js` | 차례 진행 상태 기계, 되돌리기, 저장, 통계 | rules, ai, party |
| `js/ui.js` | DOM 화면(설정·HUD·결과 토큰·배너·미션 카드·시상식) | theme |
| `js/main.js` | 모두 연결 | 전부 |

## 좌표

- 판 중심이 원점, y가 위. 판 한 변 `BS=10.6`, 윗면 높이 `BT=0.35`. 칸 좌표 `NODE[n] = [x, z]`(scene.js).
- 0번 칸(참먹이)은 (4, 4) — 카메라 쪽 오른쪽 모서리. 1→5는 z가 줄어드는 방향.
- 카메라는 +z 쪽 위에서 판을 내려다본다(theta 0, phi ≈ 0.7rad).
- `ctx.matSide`: 세로 화면이면 `'bottom'`(멍석이 판 아래 z≈+7.8, 방석은 판 위쪽 z=−6.45),
  가로 화면이면 `'right'`(멍석이 판 오른쪽 x≈+9, 방석은 판 왼쪽 x=−6.45). 바뀌면 `ctx.onLayout(fn)`이 불린다.
- 방석 칸: `nestSlot(t, i, teamCount, side)` → {x, y:0.13, z}. 완주 지점 `FIN_XZ = [4.74, 4.74]`.

## scene ctx (createScene이 돌려줌)

```
ctx.THREE, ctx.renderer, ctx.scene, ctx.camera, ctx.world(Group), ctx.tier('high'|'mid'|'low')
ctx.invalidate()                  // 다음 프레임에 다시 그림
ctx.poke()                        // 사용자 입력이 있었음(대기 동작 20초 연장)
ctx.addTicker(fn(dt, now))        // 매 프레임 호출. 'active' 반환 = 60fps로 그려야 함, true = 대기 동작(30fps), falsy = 그릴 필요 없음
ctx.removeTicker(fn)
ctx.matSide, ctx.onLayout(fn(side))
ctx.setBoxes({ board, mat })      // 카메라 맞춤 상자 {x0,x1,z0,z1,y1}
ctx.setFraming('board'|'throw')   // 판만 크게 / 판+멍석
ctx.shake(amp, ms), ctx.punch(amount, ms) → Promise   // 흔들림, 잠깐 확대
ctx.pick.add(obj, data, prio), ctx.pick.remove(obj), ctx.pick.clear(pred)   // 탭 대상(prio 큰 것이 먼저)
ctx.setFlickZones([obj]), ctx.onFlick(fn(power), canFlick), ctx.onPick(fn(data))
ctx.toScreen(vec3) → {x, y}       // stage 기준 CSS px
```

## 효과음 이름 (audio.play(name, opts))

`tap`, `throwStart`, `stickLand {vol}`, `drumroll {ms}`, `result {r}`(-1,1..5,'nak'), `hop {step}`(0부터, 5음계로 올라감),
`land`, `bigLand`, `whoosh`, `shortcut`, `stack`, `capture`, `finish`, `teamDone`, `win`, `turn`, `cry {species}`,
`event {kind}`(gift|magpie|gate|puddle|friend|mission), `clap`, `pop`, `backdo`, `bell`, `sparkle`, `select`.
진동: `audio.buzz(name)`. 음악: `audio.music(on)`, `audio.setTension(on)`.

## 추가 약속

- `audio.play(name, { vol, pan, ... })`는 멈춤 함수(`stop`)를 돌려준다. `stop.duration`은 소리 길이(초). 윷가락 모듈은 이것으로 드르륵(drumroll)을 도중에 끈다. `audio.dispose()`가 있다. 배경 음악은 평조(G)로, 한 칸 음과 같은 음을 쓴다.
- 음성: 보통 우선순위 문장은 높은 우선순위 문장이 끝날 때까지 한 자리에서 기다리고, 4초가 지나면 버린다.
- `yut.floorAt(x, z)` → 멍석 윗면 높이(없으면 null). `createFx(ctx, { floorAt })` 또는 `fx.setFloor(fn)`으로 색종이가 멍석 위에 내려앉는다. 윷가락 하나는 재질 하나(아틀라스)를 쓴다.
- 탭 우선순위: 도착 번호 표지(3) > 말 위 번호 핀(1.6) > 고를 수 있는 말·새로 올릴 대기 말(1.5) > 도착 칸(1.2) > 다른 말(1).
- `pieces.setQuality('high'|'low'|'min')`: 느린 기기에서 먼지·색종이·버릇을 끈다. `main.js`가 한가할 때의 프레임 간격을 기준으로 스스로 낮춘다(저장하지 않음).
- `game.anim`: 윷가락이 날거나 말이 움직이는 동안 `{ kind: 'throw'|'move' }`. 화면은 이때 새 결과를 미리 보여 주지 않는다.
- 저장본의 `G.moving`: 연출 중인 수. 새로고침 뒤 `resume()`이 그 수의 뒷마무리(잔치 칸 효과 → 완주 확인)부터 한다. 효과를 적용하면 `eff`를 비워 두 번 적용되지 않는다.
- 배포 전에 `python3 tools/stamp.py`로 서비스워커 버전을 갱신하고 `tools/test.sh`로 테스트한다.
