import { useState, useRef, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

// 상수
const SYSTEM_PROMPT = `
당신은 "FitMate AI", 사용자의 전담 AI 퍼스널 트레이너입니다.

[페르소나]
- 에너지 넘치고 동기부여 중심의 코칭형 말투를 사용하세요.
- 전문적인 운동 원리를 쉽게 풀어 설명해주세요.
- 한국어로 응답하세요.

[응답 구조] 상황에 맞게 아래 구조를 활용하세요:
1. 목표 확인 / 격려 한 마디
2. 핵심 분석 또는 루틴 (구체적 세트/횟수 포함)
3. 주의사항 또는 팁
4. 다음 액션 제안

[운동 기록 분석 시]
- 총 볼륨(세트×횟수×무게), 주간 빈도, 근육군 밸런스를 분석하세요.
- 피로도 신호(연속 운동일, 볼륨 급증)를 감지하면 회복을 권장하세요.
- 성장 추세가 보이면 구체적으로 칭찬하고 다음 목표를 제시하세요.

답변은 핵심 위주로 간결하되, 필요 시 상세 설명을 추가하세요.
마크다운 형식(볼드, 리스트 등)을 적극 활용해 가독성을 높이세요.
`;

const DIET_SYSTEM_PROMPT = `
당신은 "FitMate AI"의 영양 분석 전문가입니다.

[역할]
사용자가 업로드한 식단 사진을 분석하여 영양 정보를 추정합니다.

[응답 형식] 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요:
{
  "foods": [
    { "name": "음식명", "amount": "양(g 또는 인분)", "calories": 숫자, "protein": 숫자, "carbs": 숫자, "fat": 숫자 }
  ],
  "total": { "calories": 숫자, "protein": 숫자, "carbs": 숫자, "fat": 숫자 },
  "mealType": "아침|점심|저녁|간식",
  "healthScore": 1~10 사이 숫자,
  "comment": "이 식단에 대한 한 줄 코칭 코멘트 (동기부여 말투, 한국어)"
}

[분석 기준]
- 한국 음식 DB 기준으로 칼로리 추정
- 음식이 불명확할 경우 가장 유사한 음식으로 추정
- 단백질/탄수화물/지방은 그램(g) 단위
- healthScore: 단백질 비율, 채소 포함 여부, 가공식품 여부 등을 종합 평가
`;

const MUSCLE_GROUPS = ["전체", "가슴", "등", "어깨", "팔", "하체", "복근", "유산소"];
const EXAMPLE_WORKOUTS = [
  { name: "벤치프레스", muscle: "가슴" },
  { name: "스쿼트", muscle: "하체" },
  { name: "데드리프트", muscle: "등" },
  { name: "오버헤드프레스", muscle: "어깨" },
  { name: "풀업", muscle: "등" },
  { name: "런지", muscle: "하체" },
  { name: "딥스", muscle: "가슴" },
  { name: "바벨컬", muscle: "팔" },
];
// 유틸
function formatDate(d) {
  return new Date(d).toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function calcVolume(sets) {
  return sets.reduce((s, x) => s + (Number(x.reps) || 0) * (Number(x.weight) || 1), 0);
}
function getRecordExercises(record) {
  if (record?.exercises?.length) return record.exercises;
  if (record?.name) {
    return [{
      name: record.name,
      muscle: record.muscle,
      sets: record.sets || [],
      volume: record.volume || calcVolume(record.sets || []),
    }];
  }
  return [];
}
function formatSetsSummary(sets = []) {
  return sets
    .filter(s => s.reps)
    .map((s, i) => `${i + 1}세트 ${s.reps}회${s.weight ? ` x ${s.weight}kg` : ""}`)
    .join(" · ");
}
function getExerciseHistory(records, exerciseName) {
  const name = exerciseName.trim().toLowerCase();
  if (!name) return null;

  let latest = null;
  let bestWeight = 0;
  records.forEach(record => {
    getRecordExercises(record).forEach(ex => {
      if ((ex.name || "").trim().toLowerCase() !== name) return;
      if (!latest) latest = { date: record.date, sets: ex.sets || [], volume: ex.volume || calcVolume(ex.sets || []) };
      (ex.sets || []).forEach(s => {
        bestWeight = Math.max(bestWeight, Number(s.weight) || 0);
      });
    });
  });

  return latest ? { ...latest, bestWeight } : null;
}
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("파일 읽기 실패"));
    r.readAsDataURL(file);
  });
}
function getMealEmoji(type) {
  return { 아침: "🌅", 점심: "☀️", 저녁: "🌙", 간식: "🍪" }[type] || "🍽️";
}
function getScoreColor(score) {
  if (score >= 8) return "var(--accent)";
  if (score >= 5) return "#ffd045";
  return "var(--red)";
}

function ImeTextInput({ value, onValueChange, ...props }) {
  const [draft, setDraft] = useState(value || "");
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    if (!composing) setDraft(value || "");
  }, [value, composing]);

  return (
    <input
      {...props}
      value={draft}
      onChange={e => {
        const next = e.target.value;
        setDraft(next);
        if (!composing) onValueChange(next);
      }}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={e => {
        setComposing(false);
        const next = e.currentTarget.value;
        setDraft(next);
        onValueChange(next);
      }}
      onBlur={e => onValueChange(e.currentTarget.value)}
    />
  );
}
// 메인 컴포넌트
export default function FitMateAI() {
  const [tab, setTab] = useState("log");

  // 루틴
  const [routines, setRoutines] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fm_routines") || "[]"); } catch { return []; }
  });
  const [routineMsg, setRoutineMsg] = useState("");

  // 신체 프로필
  const defaultProfile = { name:"", gender:"남성", birthYear:"", height:"", weight:"", goal:"근비대", level:"초급", targetWeight:"", weeklyDays:"3", memo:"" };
  const [profile, setProfile] = useState(() => { try { return JSON.parse(localStorage.getItem("fm_profile") || "null"); } catch { return null; } });
  const [profileDraft, setProfileDraft] = useState(() => { try { return JSON.parse(localStorage.getItem("fm_profile") || "null") || defaultProfile; } catch { return defaultProfile; } });
  const [profileSaved, setProfileSaved] = useState(false);

  // 운동 기록 (세션 단위)
  const [records, setRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fm_records") || "[]"); } catch { return []; }
  });
  const [filterMuscle, setFilterMuscle] = useState("전체");

  // 세션 입력 상태
  const emptyExItem = () => ({ id: Date.now() + Math.random(), name:"", muscle:"가슴", sets:[{reps:"",weight:""}] });
  const [sessionDate,  setSessionDate]  = useState(today());
  const [sessionNote,  setSessionNote]  = useState("");
  const [sessionItems, setSessionItems] = useState([emptyExItem()]);
  const [fatigue,      setFatigue]      = useState(3);   // 1~5 컨디션
  const [formMsg,      setFormMsg]      = useState("");

  // PR 알림
  const [prAlert, setPrAlert] = useState(null); // { name, old, new }

  // 주간 플랜
  const [weekPlan, setWeekPlan] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fm_weekplan") || "{}"); } catch { return {}; }
  }); // { "0": routineId, "1": routineId, ... } 0=일,1=월,...

  // 세션 아이템 조작
  const addSessionItem  = () => setSessionItems(p => [...p, emptyExItem()]);
  const removeSessionItem = id => setSessionItems(p => p.filter(x => x.id !== id));
  const updItem = (id, k, v) => setSessionItems(p => p.map(x => x.id===id ? {...x,[k]:v} : x));
  const addItemSet    = id => setSessionItems(p => p.map(x => x.id===id ? {...x, sets:[...x.sets,{reps:"",weight:""}]} : x));
  const removeItemSet = (id,j) => setSessionItems(p => p.map(x => x.id===id ? {...x, sets:x.sets.filter((_,i)=>i!==j)} : x));
  const updItemSet    = (id,j,k,v) => setSessionItems(p => p.map(x => {
    if (x.id!==id) return x;
    const s=[...x.sets]; s[j]={...s[j],[k]:v}; return {...x,sets:s};
  }));

  const loadLastSession = () => {
    const last = records[0];
    const sourceExercises = last?.exercises?.length
      ? last.exercises
      : last?.name
        ? [{ name: last.name, muscle: last.muscle || "가슴", sets: last.sets || [{ reps:"", weight:"" }] }]
        : [];

    if (!sourceExercises.length) {
      setFormMsg("불러올 지난 운동 기록이 없어요.");
      setTimeout(()=>setFormMsg(""),2000);
      return;
    }

    setSessionItems(sourceExercises.map(ex => ({
      id: Date.now() + Math.random(),
      name: ex.name || "",
      muscle: ex.muscle || "가슴",
      sets: ex.sets?.length
        ? ex.sets.map(s => ({ reps: String(s.reps || ""), weight: String(s.weight || "") }))
        : [{ reps:"", weight:"" }],
    })));
    setSessionDate(today());
    setFormMsg(`${formatDate(last.date)} 운동을 불러왔어요.`);
    setTimeout(()=>setFormMsg(""),2200);
  };

  const saveSession = () => {
    const filled = sessionItems.filter(x => x.name.trim() && x.sets.some(s=>s.reps));
    if (!filled.length) { setFormMsg("운동을 1개 이상 입력하세요."); setTimeout(()=>setFormMsg(""),2000); return; }

    // PR 감지: 각 운동의 최고 무게와 비교
    const prFound = [];
    filled.forEach(x => {
      const maxNewWeight = Math.max(...x.sets.filter(s=>s.reps && s.weight).map(s=>Number(s.weight)||0));
      if (!maxNewWeight) return;
      const prevMax = records.flatMap(r => r.exercises||[])
        .filter(e => e.name === x.name.trim())
        .flatMap(e => e.sets)
        .reduce((m, s) => Math.max(m, Number(s.weight)||0), 0);
      if (maxNewWeight > prevMax) prFound.push({ name: x.name.trim(), oldPR: prevMax, newPR: maxNewWeight });
    });
    if (prFound.length) setPrAlert(prFound);

    const session = {
      id: Date.now(),
      date: sessionDate,
      note: sessionNote.trim(),
      fatigue,
      exercises: filled.map(x => ({
        name: x.name.trim(), muscle: x.muscle,
        sets: x.sets.filter(s=>s.reps),
        volume: calcVolume(x.sets.filter(s=>s.reps)),
      })),
      totalVolume: filled.reduce((s,x) => s + calcVolume(x.sets.filter(ss=>ss.reps)), 0),
    };
    setRecords(prev => [session, ...prev]);
    setSessionItems([emptyExItem()]); setSessionNote(""); setFatigue(3);
    setFormMsg("✅ 세션 저장됐어요!"); setTimeout(()=>setFormMsg(""),2000);
  };

  // 식단 기록
  const [dietRecords, setDietRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fm_diet") || "[]"); } catch { return []; }
  });
  const [dietImage, setDietImage] = useState(null);      // base64
  const [dietImagePreview, setDietImagePreview] = useState(null); // blob URL
  const [dietAnalyzing, setDietAnalyzing] = useState(false);
  const [dietResult, setDietResult] = useState(null);    // 분석 결과 JSON
  const [dietError, setDietError] = useState("");
  const [dietDate, setDietDate] = useState(today());
  const dietInputRef = useRef(null);

  // AI 챗
  const [messages, setMessages] = useState([
    { role: "assistant", content: "💪 안녕하세요! FitMate AI입니다.\n운동 기록을 저장하고 **분석 요청**을 해보세요!\n\n예시:\n- \"내 운동 기록 분석해줘\"\n- \"가슴 운동 루틴 짜줘\"\n- \"오늘 스쿼트 3×10 120kg 했어\"" }
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("fm_records", JSON.stringify(records)); } catch {}
  }, [records]);
  useEffect(() => {
    try { localStorage.setItem("fm_diet", JSON.stringify(dietRecords)); } catch {}
  }, [dietRecords]);
  useEffect(() => {
    try { if (profile) localStorage.setItem("fm_profile", JSON.stringify(profile)); } catch {}
  }, [profile]);
  useEffect(() => {
    try { localStorage.setItem("fm_routines", JSON.stringify(routines)); } catch {}
  }, [routines]);
  useEffect(() => {
    try { localStorage.setItem("fm_weekplan", JSON.stringify(weekPlan)); } catch {}
  }, [weekPlan]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  const deleteRecord = (id) => setRecords(prev => prev.filter(r => r.id !== id));
  const filtered = filterMuscle === "전체"
    ? records
    : records.filter(r => r.exercises?.some(e => e.muscle === filterMuscle));
  const stats = {
    total: records.length,  // 세션 수
    thisWeek: records.filter(r => {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(r.date) >= weekAgo;
    }).length,
    totalVolume: records.reduce((s, r) => s + (r.totalVolume || r.volume || 0), 0),
    todayKcal: dietRecords.filter(d => d.date === today()).reduce((s, d) => s + (d.total?.calories || 0), 0),
  };
  const calcStreak = () => {
    const days = [...new Set(records.map(r => r.date))].sort((a,b) => b.localeCompare(a));
    if (!days.length) return 0;
    let streak = 0;
    const todayStr = today();
    let cur = new Date(todayStr);
    // 오늘 또는 어제부터 시작
    const startDay = days[0] === todayStr ? todayStr
      : days[0] === new Date(Date.now()-86400000).toISOString().slice(0,10) ? days[0]
      : null;
    if (!startDay) return 0;
    cur = new Date(startDay);
    for (const d of days) {
      const dStr = cur.toISOString().slice(0,10);
      if (d === dStr) { streak++; cur.setDate(cur.getDate()-1); }
      else if (d < dStr) break;
    }
    return streak;
  };
  const streak = calcStreak();

  const ALL_BADGES = [
    { id:"first",    icon:"🏅", label:"첫 운동",     desc:"첫 번째 운동 기록",        check: r => r.length >= 1 },
    { id:"week1",    icon:"🔥", label:"1주 완주",     desc:"7일 연속 운동",             check: (r,s) => s >= 7 },
    { id:"total10",  icon:"💪", label:"10회 돌파",    desc:"총 운동 10회 달성",         check: r => r.length >= 10 },
    { id:"total30",  icon:"⚡", label:"30회 돌파",    desc:"총 운동 30회 달성",         check: r => r.length >= 30 },
    { id:"allMuscle",icon:"🎯", label:"균형 트레이너",desc:"6개 근육군 모두 운동",      check: r => { const s=new Set(r.map(x=>x.muscle)); return ["가슴","등","어깨","팔","하체","복근"].every(m=>s.has(m)); }},
    { id:"vol100k",  icon:"🏋️", label:"볼륨 10만",   desc:"총 볼륨 100,000 달성",     check: r => r.reduce((s,x)=>s+x.volume,0)>=100000 },
    { id:"streak3",  icon:"📅", label:"3일 연속",     desc:"3일 연속 운동",             check: (r,s) => s >= 3 },
    { id:"streak14", icon:"🌟", label:"2주 전사",     desc:"14일 연속 운동",            check: (r,s) => s >= 14 },
    { id:"diet5",    icon:"🥗", label:"식단 관리자",  desc:"식단 5회 이상 기록",        check: (r,s,d) => d.length >= 5 },
    { id:"early",    icon:"🌅", label:"얼리버드",     desc:"아침 6-9시 운동 3회",       check: () => false }, // 시간 데이터 없으므로 비활성
  ];
  const earnedIds = new Set(ALL_BADGES.filter(b => b.check(records, streak, dietRecords)).map(b => b.id));
  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDietError("");
    setDietResult(null);
    const preview = URL.createObjectURL(file);
    setDietImagePreview(preview);
    const b64 = await fileToBase64(file);
    setDietImage({ b64, mediaType: file.type });
  };

  const analyzeDiet = async () => {
    if (!dietImage) return;
    setDietAnalyzing(true);
    setDietError("");
    setDietResult(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: DIET_SYSTEM_PROMPT,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: dietImage.mediaType, data: dietImage.b64 } },
              { type: "text", text: "이 식단 사진을 분석해서 JSON으로 응답해주세요." }
            ]
          }]
        }),
      });
      const data = await res.json();
      const raw = data.content?.map(b => b.text || "").join("") || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setDietResult(parsed);
    } catch (e) {
      setDietError("분석 중 오류가 발생했어요. 다시 시도해주세요.");
    } finally {
      setDietAnalyzing(false);
    }
  };

  const saveDietRecord = () => {
    if (!dietResult) return;
    setDietRecords(prev => [{
      id: Date.now(),
      date: dietDate,
      imagePreview: dietImagePreview,
      ...dietResult,
    }, ...prev]);
    setDietImage(null); setDietImagePreview(null); setDietResult(null);
    setDietError(""); if (dietInputRef.current) dietInputRef.current.value = "";
  };

  const deleteDietRecord = (id) => setDietRecords(prev => prev.filter(r => r.id !== id));

  // 오늘 식단 요약 (AI 코치 컨텍스트용)
  const todayDietSummary = dietRecords.filter(d => d.date === today())
    .map(d => `${getMealEmoji(d.mealType)}${d.mealType}: ${d.total?.calories}kcal (단백질 ${d.total?.protein}g)`)
    .join(", ");
  const sendMessage = async () => {
    if (!input.trim() || chatLoading) return;
    const userMsg = input.trim(); setInput("");
    // 프로필 컨텍스트
    const profileCtx = profile
      ? `\n\n[사용자 프로필]\n이름: ${profile.name||"미설정"} | 성별: ${profile.gender} | 목표: ${profile.goal} | 레벨: ${profile.level} | 키: ${profile.height}cm | 체중: ${profile.weight}kg | 주 ${profile.weeklyDays}회${profile.memo ? " | 메모: "+profile.memo : ""}`
      : "\n\n[프로필 미설정 - 프로필 탭에서 설정 가능]";

    // 최근 피로도 요약
    const fatigueCtx = records.slice(0,7).filter(r=>r.fatigue)
      .map(r=>`${r.date} 컨디션${r.fatigue}/5`).join(", ");
    const fatigueStr = fatigueCtx ? `
[최근 컨디션] ${fatigueCtx}` : "";

    const recordsSummary = records.length
      ? `\n\n[운동 기록 (최근 20세션)]\n` + records.slice(0, 20).map(r => {
          if (r.exercises) {
            const exStr = r.exercises.map(e =>
              `${e.name}(${e.muscle}) ${e.sets.map(s=>`${s.reps}회×${s.weight||"체중"}kg`).join(",")} 볼륨:${e.volume}`
            ).join(" / ");
            return `${r.date} | ${exStr} | 총볼륨:${r.totalVolume}`;
          }
          return `${r.date} | ${r.name}(${r.muscle}) | 볼륨:${r.volume}`;
        }).join("\n")
      : "\n\n[운동 기록 없음]";
    const dietSummary = todayDietSummary ? `\n[오늘 식단] ${todayDietSummary}` : "";
    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages); setChatLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT + profileCtx + recordsSummary + dietSummary + fatigueStr,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.content?.map(b => b.text || "").join("") || "응답을 받지 못했어요." }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "❌ 연결 오류가 발생했어요." }]);
    } finally { setChatLoading(false); }
  };
  // 렌더
  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&display=swap');*, *::before, *::after{box-sizing:border-box;margin:0;padding:0;} :root{--bg:#0a0a0f;--surface:#12121a;--card:#1a1a26;--border:#2a2a3a;--accent:#b8ff45;--accent2:#45ffd4;--text:#e8e8f0;--muted:#6b6b85;--red:#ff4560;--orange:#ff8c45;--font-display:'Bebas Neue', sans-serif;--font-body:'Outfit', sans-serif;--radius:12px;} body{background:var(--bg);color:var(--text);font-family:var(--font-body);} .app{min-height:100vh;max-width:480px;margin:0 auto;display:flex;flex-direction:column;background:var(--bg);} .header{padding:20px 20px 0;background:linear-gradient(180deg, #0d0d18 0%, transparent 100%);} .header-top{display:flex;align-items:center;gap:12px;margin-bottom:16px;} .logo-icon{width:40px;height:40px;background:var(--accent);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;} .logo-text{font-family:var(--font-display);font-size:28px;letter-spacing:2px;color:var(--text);line-height:1;} .logo-sub{font-size:11px;color:var(--accent);letter-spacing:3px;text-transform:uppercase;font-weight:600;} .stats-bar{display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;padding:16px 20px;background:var(--surface);border-bottom:1px solid var(--border);} .stat-item{text-align:center;} .stat-val{font-family:var(--font-display);font-size:22px;color:var(--accent);line-height:1;} .stat-label{font-size:10px;color:var(--muted);margin-top:2px;letter-spacing:.5px;} .tabs{display:grid;grid-template-columns:repeat(9, 1fr);background:var(--surface);border-bottom:1px solid var(--border);} .tab-btn{padding:13px 0;background:none;border:none;font-family:var(--font-body);font-size:9px;font-weight:600;color:var(--muted);cursor:pointer;position:relative;transition:color .2s;letter-spacing:.2px;} .tab-btn.active{color:var(--accent);} .tab-btn.active::after{content:'';position:absolute;bottom:0;left:15%;right:15%;height:2px;background:var(--accent);border-radius:2px 2px 0 0;} .content{flex:1;overflow-y:auto;padding:20px;} .content::-webkit-scrollbar{width:4px;} .content::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;} .card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:14px;} .card-title{font-family:var(--font-display);font-size:16px;letter-spacing:1.5px;color:var(--accent);margin-bottom:14px;} label{display:block;font-size:11px;font-weight:600;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;} input[type="text"], input[type="date"], input[type="number"], select, textarea{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-family:var(--font-body);font-size:14px;outline:none;transition:border-color .2s;margin-bottom:12px;} input:focus, select:focus, textarea:focus{border-color:var(--accent);} select option{background:var(--card);} textarea{resize:vertical;min-height:60px;} .sets-header{display:grid;grid-template-columns:1fr 1fr 32px;gap:8px;margin-bottom:6px;} .sets-header span{font-size:10px;font-weight:600;color:var(--muted);letter-spacing:1px;text-transform:uppercase;} .set-row{display:grid;grid-template-columns:1fr 1fr 32px;gap:8px;margin-bottom:8px;align-items:center;} .set-row input{margin-bottom:0;} .icon-btn{width:32px;height:32px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--muted);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;} .icon-btn:hover{border-color:var(--red);color:var(--red);} .btn{padding:12px 20px;border-radius:8px;font-family:var(--font-body);font-size:14px;font-weight:700;cursor:pointer;border:none;transition:all .2s;letter-spacing:.5px;} .btn-primary{background:var(--accent);color:#000;width:100%;margin-top:4px;} .btn-primary:hover{filter:brightness(1.1);transform:translateY(-1px);} .btn-primary:disabled{opacity:.4;cursor:not-allowed;transform:none;filter:none;} .btn-ghost{background:transparent;border:1px solid var(--border);color:var(--muted);font-size:12px;padding:7px 14px;} .btn-ghost:hover{border-color:var(--accent2);color:var(--accent2);} .btn-save{background:color-mix(in srgb, var(--accent2) 20%, transparent);border:1px solid var(--accent2);color:var(--accent2);width:100%;margin-top:8px;} .btn-save:hover{background:color-mix(in srgb, var(--accent2) 30%, transparent);} .form-msg{font-size:13px;color:var(--accent);text-align:center;margin-top:8px;min-height:20px;font-weight:600;} .chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;} .chip{padding:6px 12px;background:var(--surface);border:1px solid var(--border);border-radius:20px;font-size:12px;color:var(--muted);cursor:pointer;transition:all .2s;} .chip:hover, .chip.active{background:color-mix(in srgb, var(--accent) 15%, transparent);border-color:var(--accent);color:var(--accent);} .rec-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;position:relative;} .rec-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;} .rec-name{font-weight:700;font-size:16px;color:var(--text);} .rec-date{font-size:11px;color:var(--muted);margin-top:2px;} .muscle-tag{display:inline-block;padding:3px 10px;background:color-mix(in srgb, var(--accent2) 15%, transparent);border:1px solid color-mix(in srgb, var(--accent2) 40%, transparent);border-radius:20px;font-size:11px;color:var(--accent2);font-weight:600;} .rec-sets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;} .set-pill{padding:4px 10px;background:var(--card);border-radius:6px;font-size:12px;color:var(--text);font-weight:500;} .rec-volume{font-size:12px;color:var(--muted);} .rec-volume span{color:var(--accent);font-weight:700;} .rec-note{font-size:12px;color:var(--muted);margin-top:6px;font-style:italic;} .del-btn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;transition:color .2s;flex-shrink:0;} .del-btn:hover{color:var(--red);} .empty{text-align:center;padding:40px 20px;color:var(--muted);} .empty-icon{font-size:40px;margin-bottom:10px;} .empty-text{font-size:14px;line-height:1.6;} .filter-bar{display:flex;gap:8px;overflow-x:auto;margin-bottom:16px;padding-bottom:4px;} .filter-bar::-webkit-scrollbar{display:none;} .diet-upload-area{border:2px dashed var(--border);border-radius:var(--radius);padding:28px 20px;text-align:center;cursor:pointer;transition:all .25s;margin-bottom:14px;background:var(--surface);position:relative;overflow:hidden;} .diet-upload-area:hover{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 5%, var(--surface));} .diet-upload-area.has-image{border-color:var(--accent);padding:0;} .upload-preview{width:100%;max-height:220px;object-fit:cover;border-radius:10px;display:block;} .upload-overlay{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;border-radius:10px;} .diet-upload-area:hover .upload-overlay{opacity:1;} .upload-overlay-text{color:#fff;font-size:13px;font-weight:600;} .upload-icon{font-size:36px;margin-bottom:10px;} .upload-hint{font-size:13px;color:var(--muted);line-height:1.5;} .upload-hint strong{color:var(--accent);} .analysis-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:14px;animation:fadeIn .3s ease;} .analysis-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);background:color-mix(in srgb, var(--accent) 8%, var(--surface));} .meal-type-badge{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;color:var(--text);} .health-score{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;} .score-bar-wrap{width:60px;height:6px;background:var(--border);border-radius:3px;overflow:hidden;} .score-bar{height:100%;border-radius:3px;transition:width .5s ease;} .macro-grid{display:grid;grid-template-columns:repeat(4, 1fr);padding:14px 16px;gap:10px;border-bottom:1px solid var(--border);} .macro-item{text-align:center;} .macro-val{font-family:var(--font-display);font-size:20px;line-height:1;} .macro-unit{font-size:10px;color:var(--muted);margin-top:2px;} .macro-label{font-size:10px;color:var(--muted);margin-top:2px;letter-spacing:.5px;} .food-list{padding:12px 16px;border-bottom:1px solid var(--border);} .food-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);} .food-row:last-child{border-bottom:none;} .food-name{font-size:13px;font-weight:500;color:var(--text);} .food-amount{font-size:12px;color:var(--muted);margin-top:2px;} .food-kcal{font-size:13px;font-weight:700;color:var(--accent);white-space:nowrap;} .diet-comment{padding:12px 16px;font-size:13px;color:var(--text);line-height:1.6;background:color-mix(in srgb, var(--accent2) 5%, var(--surface));} .diet-comment::before{content:'💬 ';} .diet-hist-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:12px;} .diet-hist-top{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);} .diet-thumb{width:54px;height:54px;object-fit:cover;border-radius:8px;flex-shrink:0;background:var(--card);} .diet-thumb-placeholder{width:54px;height:54px;border-radius:8px;background:var(--card);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;} .diet-hist-info{flex:1;} .diet-hist-name{font-weight:700;font-size:15px;color:var(--text);} .diet-hist-meta{font-size:11px;color:var(--muted);margin-top:3px;} .diet-hist-kcal{font-family:var(--font-display);font-size:20px;color:var(--accent);} .diet-macro-row{display:flex;gap:14px;padding:10px 14px;} .diet-macro-chip{font-size:12px;color:var(--muted);} .diet-macro-chip span{color:var(--text);font-weight:600;} .analyzing-wrap{display:flex;flex-direction:column;align-items:center;padding:30px;gap:14px;} .spinner{width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;} @keyframes spin{to{transform:rotate(360deg);}} .analyzing-text{font-size:14px;color:var(--muted);} .chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 240px);} .chat-msgs{flex:1;overflow-y:auto;padding-bottom:16px;} .chat-msgs::-webkit-scrollbar{width:3px;} .chat-msgs::-webkit-scrollbar-thumb{background:var(--border);} .msg-row{display:flex;margin-bottom:14px;gap:10px;} .msg-row.user{flex-direction:row-reverse;} .msg-avatar{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;align-self:flex-end;} .msg-row.assistant .msg-avatar{background:var(--accent);} .msg-row.user .msg-avatar{background:var(--card);border:1px solid var(--border);} .msg-bubble{max-width:82%;padding:12px 14px;border-radius:14px;font-size:13.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word;} .msg-row.assistant .msg-bubble{background:var(--card);border:1px solid var(--border);border-bottom-left-radius:4px;} .msg-row.user .msg-bubble{background:color-mix(in srgb, var(--accent) 20%, transparent);border:1px solid color-mix(in srgb, var(--accent) 40%, transparent);border-bottom-right-radius:4px;} .msg-bubble strong{color:var(--accent);font-weight:700;} .msg-bubble em{color:var(--accent2);font-style:normal;font-weight:500;} .typing-dot{display:inline-block;width:7px;height:7px;background:var(--accent);border-radius:50%;margin:0 2px;animation:bounce .8s infinite;} .typing-dot:nth-child(2){animation-delay:.15s;} .typing-dot:nth-child(3){animation-delay:.3s;} @keyframes bounce{0%,80%,100%{transform:translateY(0);} 40%{transform:translateY(-6px);}} .chat-input-row{display:flex;gap:8px;padding-top:12px;border-top:1px solid var(--border);} .chat-input{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;color:var(--text);font-family:var(--font-body);font-size:14px;outline:none;resize:none;max-height:100px;} .chat-input:focus{border-color:var(--accent);} .send-btn{width:44px;height:44px;background:var(--accent);border:none;border-radius:10px;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;align-self:flex-end;transition:all .2s;} .send-btn:hover:not(:disabled){filter:brightness(1.1);transform:scale(1.05);} .send-btn:disabled{opacity:.4;cursor:not-allowed;} .quick-prompts{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;} .qp-btn{padding:6px 12px;background:var(--card);border:1px solid var(--border);border-radius:20px;font-size:12px;color:var(--muted);cursor:pointer;font-family:var(--font-body);transition:all .2s;} .qp-btn:hover{border-color:var(--accent);color:var(--accent);} .chart-section{margin-bottom:20px;} .chart-section-title{font-family:var(--font-display);font-size:14px;letter-spacing:1.5px;color:var(--accent);margin-bottom:12px;display:flex;align-items:center;gap:8px;} .chart-section-title span{font-family:var(--font-body);font-size:11px;color:var(--muted);letter-spacing:0;font-weight:400;} .chart-box{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 8px 8px;} .chart-filter-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;} .period-btn{padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;background:var(--surface);border:1px solid var(--border);color:var(--muted);cursor:pointer;font-family:var(--font-body);transition:all .2s;} .period-btn.active{background:color-mix(in srgb, var(--accent) 15%, transparent);border-color:var(--accent);color:var(--accent);} .muscle-select-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;} .muscle-btn{padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;background:var(--surface);border:1px solid var(--border);color:var(--muted);cursor:pointer;font-family:var(--font-body);transition:all .2s;} .muscle-btn.active{background:color-mix(in srgb, var(--accent2) 15%, transparent);border-color:var(--accent2);color:var(--accent2);} .summary-row{display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-bottom:16px;} .summary-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;} .summary-val{font-family:var(--font-display);font-size:22px;line-height:1;margin-bottom:4px;} .summary-label{font-size:10px;color:var(--muted);letter-spacing:.5px;} .no-data{text-align:center;padding:30px 0;color:var(--muted);font-size:13px;} .ct{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;} .ct-label{font-weight:700;color:var(--text);margin-bottom:4px;} .ct-row{color:var(--muted);} .ct-row span{font-weight:700;} .profile-avatar-row{display:flex;align-items:center;gap:16px;margin-bottom:20px;} .profile-avatar{width:64px;height:64px;border-radius:50%;background:color-mix(in srgb, var(--accent) 20%, var(--surface));border:2px solid var(--accent);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;} .profile-name-big{font-family:var(--font-display);font-size:22px;letter-spacing:1px;color:var(--text);} .profile-sub{font-size:12px;color:var(--muted);margin-top:3px;} .profile-bmi{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-top:4px;} .section-divider{font-family:var(--font-display);font-size:13px;letter-spacing:2px;color:var(--accent);margin:18px 0 12px;display:flex;align-items:center;gap:10px;} .section-divider::after{content:'';flex:1;height:1px;background:var(--border);} .radio-group{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;} .radio-btn{padding:7px 16px;border-radius:20px;font-size:13px;font-weight:600;background:var(--surface);border:1px solid var(--border);color:var(--muted);cursor:pointer;font-family:var(--font-body);transition:all .2s;} .radio-btn.active{background:color-mix(in srgb, var(--accent) 18%, transparent);border-color:var(--accent);color:var(--accent);} .radio-btn.active-blue{background:color-mix(in srgb, var(--accent2) 18%, transparent);border-color:var(--accent2);color:var(--accent2);} .two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px;} .two-col > div label{margin-top:0;} .two-col > div input{margin-bottom:0;} .goal-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;} .goal-card{padding:14px 12px;border-radius:10px;background:var(--surface);border:1px solid var(--border);cursor:pointer;transition:all .2s;text-align:center;} .goal-card:hover{border-color:var(--accent);} .goal-card.active{background:color-mix(in srgb, var(--accent) 12%, transparent);border-color:var(--accent);} .goal-card-icon{font-size:24px;margin-bottom:6px;} .goal-card-label{font-size:13px;font-weight:700;color:var(--text);} .goal-card-desc{font-size:10px;color:var(--muted);margin-top:3px;line-height:1.4;} .target-info-box{background:color-mix(in srgb, var(--accent2) 8%, var(--surface));border:1px solid color-mix(in srgb, var(--accent2) 30%, transparent);border-radius:10px;padding:14px 16px;margin-bottom:14px;} .target-info-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px;} .target-info-row:last-child{margin-bottom:0;} .target-info-label{color:var(--muted);} .target-info-val{font-weight:700;color:var(--text);} .save-success{background:color-mix(in srgb, var(--accent) 15%, transparent);border:1px solid color-mix(in srgb, var(--accent) 40%, transparent);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--accent);text-align:center;font-weight:700;margin-top:10px;animation:fadeIn .2s;} .streak-banner{display:flex;align-items:center;gap:8px;padding:10px 20px;background:linear-gradient(90deg, color-mix(in srgb,#ff8c45 25%,transparent), color-mix(in srgb,#b8ff45 15%,transparent));border-bottom:1px solid color-mix(in srgb,#ff8c45 30%,transparent);} .streak-fire{font-size:20px;animation:pulse 1s infinite;} @keyframes pulse{0%,100%{transform:scale(1)} 50%{transform:scale(1.2)}} .streak-num{font-family:var(--font-display);font-size:22px;color:#ff8c45;letter-spacing:1px;} .streak-label{font-size:13px;font-weight:600;color:var(--text);flex:1;} .streak-badge{font-size:11px;font-weight:700;padding:3px 10px;background:color-mix(in srgb,var(--accent) 20%,transparent);border:1px solid color-mix(in srgb,var(--accent) 50%,transparent);border-radius:20px;color:var(--accent);} .badge-hero{background:linear-gradient(135deg, #1a1a26 0%, #0f1a0f 100%);border:1px solid var(--border);border-radius:var(--radius);padding:24px 20px;text-align:center;margin-bottom:16px;} .badge-hero-streak{font-family:var(--font-display);font-size:56px;color:#ff8c45;line-height:1;} .badge-progress-row{display:flex;align-items:center;gap:10px;margin-top:14px;} .badge-progress-bar{flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;} .badge-progress-fill{height:100%;border-radius:3px;background:var(--accent);transition:width .6s ease;} .badge-progress-label{font-size:11px;color:var(--muted);white-space:nowrap;} .badge-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;} .badge-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 12px;text-align:center;position:relative;transition:all .25s;} .badge-card.earned{background:linear-gradient(135deg, color-mix(in srgb,var(--accent) 8%,var(--card)), var(--card));border-color:color-mix(in srgb,var(--accent) 50%,transparent);box-shadow:0 0 16px color-mix(in srgb,var(--accent) 12%,transparent);} .badge-card.locked{opacity:.45;filter:grayscale(0.6);} .badge-icon{font-size:32px;margin-bottom:8px;} .badge-name{font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;} .badge-desc{font-size:10px;color:var(--muted);line-height:1.4;} .badge-earned-mark{position:absolute;top:8px;right:8px;font-size:10px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 15%,transparent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);border-radius:10px;padding:2px 7px;} .badge-section-title{font-family:var(--font-display);font-size:14px;letter-spacing:1.5px;color:var(--accent2);margin:16px 0 10px;} .streak-calendar{display:grid;grid-template-columns:repeat(7, 1fr);gap:5px;margin-top:12px;} .cal-day{aspect-ratio:1;border-radius:5px;font-size:9px;display:flex;align-items:center;justify-content:center;font-weight:600;} .cal-day.worked{background:var(--accent);color:#000;} .cal-day.rest{background:var(--border);color:var(--muted);} .cal-day.future{background:transparent;} .cal-label{font-size:9px;color:var(--muted);text-align:center;} .routine-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:12px;transition:border-color .2s;} .routine-card:hover{border-color:color-mix(in srgb,var(--accent) 50%,transparent);} .routine-header{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);cursor:pointer;} .routine-icon{width:40px;height:40px;border-radius:10px;background:color-mix(in srgb,var(--accent) 18%,transparent);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;} .routine-title{font-size:16px;font-weight:700;color:var(--text);} .routine-meta{font-size:11px;color:var(--muted);margin-top:3px;} .routine-actions{display:flex;gap:8px;padding:12px 16px;background:var(--surface);} .routine-ex-list{padding:12px 16px;} .routine-ex-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;} .routine-ex-row:last-child{border-bottom:none;} .routine-ex-name{font-weight:600;color:var(--text);flex:1;} .routine-ex-sets{font-size:12px;color:var(--muted);} .routine-ex-muscle{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);} .btn-load{flex:1;padding:9px;background:var(--accent);color:#000;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;font-family:var(--font-body);transition:all .2s;} .btn-load:hover{filter:brightness(1.1);} .btn-del-routine{padding:9px 14px;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer;font-family:var(--font-body);transition:all .2s;} .btn-del-routine:hover{border-color:var(--red);color:var(--red);} .routine-form{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:16px;} .routine-ex-builder{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;} .ex-builder-top{display:flex;align-items:center;gap:8px;margin-bottom:8px;} .ex-builder-name{flex:1;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px;font-family:var(--font-body);outline:none;} .ex-builder-name:focus{border-color:var(--accent);} .ex-set-row{display:grid;grid-template-columns:1fr 1fr 28px;gap:6px;margin-bottom:6px;} .ex-set-input{background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;font-family:var(--font-body);outline:none;width:100%;} .ex-set-input:focus{border-color:var(--accent);} .mini-icon-btn{width:28px;height:28px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--muted);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s;align-self:center;} .mini-icon-btn:hover{border-color:var(--red);color:var(--red);} .muscle-select-sm{background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;font-family:var(--font-body);outline:none;width:100%;margin-bottom:8px;} .muscle-select-sm:focus{border-color:var(--accent);} .preset-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;} .preset-chip{padding:5px 12px;border-radius:20px;font-size:11px;font-weight:600;background:var(--surface);border:1px solid var(--border);color:var(--muted);cursor:pointer;transition:all .2s;} .preset-chip:hover{border-color:var(--accent2);color:var(--accent2);} .routine-saved-msg{font-size:13px;color:var(--accent);text-align:center;font-weight:700;margin-top:8px;min-height:20px;} .empty-routine{text-align:center;padding:30px 20px;color:var(--muted);} .tab-btn{font-size:8.5px;} .fatigue-row{display:flex;gap:6px;margin-bottom:14px;} .fatigue-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 4px;border-radius:10px;border:1px solid var(--border);background:var(--surface);cursor:pointer;transition:all .2s;} .fatigue-btn:hover{border-color:var(--accent);} .fatigue-btn.active{background:color-mix(in srgb,var(--accent) 15%,transparent);border-color:var(--accent);} .fatigue-emoji{font-size:20px;} .fatigue-label{font-size:9px;color:var(--muted);text-align:center;line-height:1.2;font-weight:600;} .fatigue-btn.active .fatigue-label{color:var(--accent);} .fatigue-tag{font-size:11px;color:var(--muted);padding:2px 8px;background:var(--card);border-radius:20px;border:1px solid var(--border);} .pr-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .2s;} .pr-modal{background:var(--card);border:1px solid var(--accent);border-radius:16px;padding:24px;width:100%;max-width:340px;box-shadow:0 0 40px color-mix(in srgb,var(--accent) 30%,transparent);} .pr-modal-title{font-family:var(--font-display);font-size:22px;letter-spacing:2px;color:var(--accent);text-align:center;margin-bottom:16px;} .pr-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);} .pr-row:last-of-type{border-bottom:none;} .pr-ex-name{font-size:14px;font-weight:700;color:var(--text);} .pr-weights{font-size:13px;color:var(--muted);} .pr-weights strong{color:var(--accent);font-size:16px;} .plan-banner{display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:12px;background:color-mix(in srgb,var(--accent2) 10%,var(--surface));border:1px solid color-mix(in srgb,var(--accent2) 35%,transparent);border-radius:var(--radius);} .plan-banner-icon{font-size:26px;flex-shrink:0;} .plan-banner-info{flex:1;} .plan-banner-label{font-size:10px;color:var(--accent2);font-weight:700;letter-spacing:1px;text-transform:uppercase;} .plan-banner-name{font-size:15px;font-weight:700;color:var(--text);margin-top:2px;} .plan-banner-btn{padding:8px 14px;background:var(--accent2);color:#000;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font-body);flex-shrink:0;transition:all .2s;} .plan-banner-btn:hover{filter:brightness(1.1);} .week-grid{display:grid;gap:8px;margin-bottom:20px;} .week-row{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;transition:border-color .2s;} .week-row.today{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--card));} .week-day-label{font-family:var(--font-display);font-size:18px;letter-spacing:1px;width:28px;flex-shrink:0;color:var(--muted);} .week-row.today .week-day-label{color:var(--accent);} .week-day-full{font-size:10px;color:var(--muted);width:28px;text-align:center;flex-shrink:0;} .week-routine-select{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-family:var(--font-body);font-size:13px;outline:none;} .week-routine-select:focus{border-color:var(--accent);} .week-routine-pill{flex:1;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;background:color-mix(in srgb,var(--accent2) 15%,transparent);color:var(--accent2);border:1px solid color-mix(in srgb,var(--accent2) 40%,transparent);} .week-today-badge{font-size:10px;font-weight:700;padding:3px 8px;background:var(--accent);color:#000;border-radius:10px;flex-shrink:0;} .hist-view-toggle{display:flex;gap:6px;margin-bottom:14px;} .view-btn{flex:1;padding:9px;border-radius:8px;font-size:13px;font-weight:700;background:var(--surface);border:1px solid var(--border);color:var(--muted);cursor:pointer;font-family:var(--font-body);transition:all .2s;} .view-btn.active{background:color-mix(in srgb,var(--accent) 15%,transparent);border-color:var(--accent);color:var(--accent);} .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;} .cal-nav-btn{width:34px;height:34px;border-radius:8px;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;} .cal-nav-btn:hover{border-color:var(--accent);color:var(--accent);} .cal-month-label{font-family:var(--font-display);font-size:20px;letter-spacing:2px;color:var(--text);} .cal-dow-row{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:4px;} .cal-dow-cell{text-align:center;font-size:10px;font-weight:700;color:var(--muted);padding:4px 0;} .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;} .cal-cell{aspect-ratio:1;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative;transition:all .2s;background:var(--surface);border:1px solid transparent;font-size:13px;font-weight:600;color:var(--muted);} .cal-cell.other-month{opacity:.3;cursor:default;} .cal-cell.has-record{background:color-mix(in srgb,var(--accent) 12%,var(--surface));border-color:color-mix(in srgb,var(--accent) 35%,transparent);color:var(--text);} .cal-cell.today{border-color:var(--accent);color:var(--accent);font-weight:800;} .cal-cell.selected{background:var(--accent);color:#000;border-color:var(--accent);} .cal-cell.has-record.selected{background:var(--accent);color:#000;} .cal-dot{width:4px;height:4px;border-radius:50%;background:var(--accent);position:absolute;bottom:4px;} .cal-cell.selected .cal-dot{background:#000;} .cal-fatigue-dot{width:5px;height:5px;border-radius:50%;position:absolute;top:4px;right:4px;} .day-detail-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;} .day-detail-date{font-family:var(--font-display);font-size:18px;letter-spacing:1px;color:var(--accent);} .day-detail-empty{text-align:center;padding:24px;color:var(--muted);font-size:13px;} .error-msg{background:color-mix(in srgb, var(--red) 15%, transparent);border:1px solid color-mix(in srgb, var(--red) 40%, transparent);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--red);margin-bottom:12px;} @keyframes fadeIn{from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:translateY(0);}} .rec-card, .msg-row, .analysis-card, .diet-hist-card{animation:fadeIn .25s ease;}.mb-6{margin-bottom:6px}.mb-8{margin-bottom:8px}.mb-12{margin-bottom:12px}.mb-14{margin-bottom:14px}.mb-16{margin-bottom:16px}.mt-4{margin-top:4px}.mt-8{margin-top:8px}.mt-12{margin-top:12px}.pb-24{padding-bottom:24px}.flex-1{flex:1}.fs-10-muted{font-size:10px;color:var(--muted)}.fs-11-muted{font-size:11px;color:var(--muted)}.fs-12-muted{font-size:12px;color:var(--muted)}.fs-13-muted{font-size:13px;color:var(--muted)}`}</style>

      <div className="app">

        {/* ── Header ── */}
        <div className="header">
          <div className="header-top">
            <div className="logo-icon">💪</div>
            <div>
              <div className="logo-text">FITMATE AI</div>
              <div className="logo-sub">Personal Trainer</div>
            </div>
          </div>
        </div>

        {/* ── Stats bar ── */}
        <div className="stats-bar">
          <div className="stat-item">
            <div className="stat-val">{stats.total}</div>
            <div className="stat-label">총 운동</div>
          </div>
          <div className="stat-item">
            <div className="stat-val">{stats.thisWeek}</div>
            <div className="stat-label">이번 주</div>
          </div>
          <div className="stat-item">
            <div className="stat-val">{stats.totalVolume > 999 ? (stats.totalVolume/1000).toFixed(1)+"k" : stats.totalVolume}</div>
            <div className="stat-label">총 볼륨</div>
          </div>
          <div className="stat-item">
            <div className="stat-val" style={{ fontSize: stats.todayKcal > 0 ? 18 : 22, paddingTop: 2 }}>
              {stats.todayKcal > 0 ? stats.todayKcal : "-"}
            </div>
            <div className="stat-label">오늘 kcal</div>
          </div>
        </div>

        {/* ── 스트릭 배너 ── */}
        {streak > 0 && (
          <div className="streak-banner">
            <span className="streak-fire">🔥</span>
            <span className="streak-num">{streak}일</span>
            <span className="streak-label">연속 운동 중!</span>
            {streak >= 7 && <span className="streak-badge">주간 달성 🏆</span>}
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="tabs">
          {[["log","📝 기록"], ["routine","📋 루틴"], ["plan","📅 플랜"], ["diet","🍱 식단"], ["chart","📈 차트"], ["badge","🏆 뱃지"], ["history","🗂 기록"], ["chat","🤖 코치"], ["profile","👤 프로필"]].map(([key, label]) => (
            <button key={key} className={`tab-btn ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="content">

          {/* ──────────── 기록 탭 (세션 단위) ──────────── */}
          {tab === "log" && (
            <>
              {/* PR 알림 모달 */}
              {prAlert && (
                <div className="pr-modal-overlay" onClick={()=>setPrAlert(null)}>
                  <div className="pr-modal" onClick={e=>e.stopPropagation()}>
                    <div className="pr-modal-title">🎉 개인 기록 달성!</div>
                    {prAlert.map((p,i)=>(
                      <div key={i} className="pr-row">
                        <span className="pr-ex-name">{p.name}</span>
                        <span className="pr-weights">
                          {p.oldPR ? `${p.oldPR}kg → ` : "첫 기록 "}<strong>{p.newPR}kg</strong>
                        </span>
                      </div>
                    ))}
                    <button className="btn btn-primary" style={{marginTop:14}} onClick={()=>setPrAlert(null)}>
                      확인 💪
                    </button>
                  </div>
                </div>
              )}

              {/* 오늘 주간플랜 배너 */}
              {(() => {
                const dow = new Date().getDay(); // 0=일
                const todayRoutineId = weekPlan[String(dow)];
                const todayRoutine = routines.find(r => r.id === todayRoutineId);
                if (!todayRoutine) return null;
                return (
                  <div className="plan-banner">
                    <span className="plan-banner-icon">{todayRoutine.icon}</span>
                    <div className="plan-banner-info">
                      <div className="plan-banner-label">오늘의 루틴</div>
                      <div className="plan-banner-name">{todayRoutine.name}</div>
                    </div>
                    <button className="plan-banner-btn" onClick={() => {
                      const items = todayRoutine.exercises.map(ex => ({
                        id: Date.now() + Math.random(),
                        name: ex.name, muscle: ex.muscle,
                        sets: ex.sets?.length ? ex.sets.map(s=>({...s})) : [{reps:"",weight:""}],
                      }));
                      setSessionItems(items);
                    }}>불러오기</button>
                  </div>
                );
              })()}

              <div className="plan-banner" style={{ marginBottom:12 }}>
                <span className="plan-banner-icon">↻</span>
                <div className="plan-banner-info">
                  <div className="plan-banner-label">빠른 기록</div>
                  <div className="plan-banner-name">
                    {records[0] ? `${formatDate(records[0].date)} 세션 반복` : "지난 세션 없음"}
                  </div>
                </div>
                <button className="plan-banner-btn" onClick={loadLastSession} disabled={!records.length}>
                  불러오기
                </button>
              </div>

              {/* 날짜 & 컨디션 & 세션 메모 */}
              <div className="card" style={{ marginBottom:12 }}>
                <div className="card-title">오늘 운동 세션</div>
                <label>날짜</label>
                <input type="date" value={sessionDate} onChange={e => setSessionDate(e.target.value)} />

                {/* 피로도 슬라이더 */}
                <label>오늘 컨디션</label>
                <div className="fatigue-row">
                  {[1,2,3,4,5].map(v => (
                    <button key={v} className={`fatigue-btn ${fatigue===v?"active":""}`}
                      onClick={()=>setFatigue(v)}>
                      <span className="fatigue-emoji">{["😴","😓","😐","😊","💪"][v-1]}</span>
                      <span className="fatigue-label">{["매우 피곤","피곤","보통","좋음","최상"][v-1]}</span>
                    </button>
                  ))}
                </div>

                <label>세션 메모 (선택)</label>
                <textarea placeholder="오늘 컨디션, 특이사항 등..." value={sessionNote}
                  onChange={e => setSessionNote(e.target.value)} style={{ minHeight:48 }} />
              </div>

              {/* 운동 종목 목록 */}
              {sessionItems.map((item, itemIdx) => (
                <div key={item.id} className="card" style={{marginBottom:10,padding:0,overflow:"hidden"}}>
                  {/* 종목 헤더 */}
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 14px 8px",borderBottom:"1px solid var(--border)"}}>
                    <span style={{fontFamily:"var(--font-display)",fontSize:13,color:"var(--accent)",letterSpacing:1,flexShrink:0}}>운동 {itemIdx + 1}</span>
                    <div style={{ flex:1, display:"grid", gridTemplateColumns:"minmax(0, 1fr) 96px", gap:8 }}>
                      <ImeTextInput
                        className="ex-builder-name"
                        type="text" placeholder="운동 이름 (예: 벤치프레스)"
                        value={item.name}
                        onValueChange={value => updItem(item.id,"name",value)}
                        style={{ width:"100%", minWidth:0, marginBottom:0 }}
                      />
                      <select className="muscle-select-sm" value={item.muscle}
                        onChange={e => updItem(item.id,"muscle",e.target.value)}
                        style={{ width:"96px", marginBottom:0 }}>
                        {MUSCLE_GROUPS.filter(m=>m!=="전체").map(m=><option key={m}>{m}</option>)}
                      </select>
                    </div>
                    {sessionItems.length > 1 && (
                      <button className="icon-btn" onClick={() => removeSessionItem(item.id)}>×</button>
                    )}
                  </div>

                  {/* 빠른 선택 칩 */}
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,padding:"0 14px 8px"}}>
                    {EXAMPLE_WORKOUTS.map(w => (
                      <div key={w.name}
                        className={`chip ${item.name===w.name?"active":""}`}
                        style={{ fontSize:11, padding:"4px 10px" }}
                        onClick={() => { updItem(item.id,"name",w.name); updItem(item.id,"muscle",w.muscle); }}>
                        {w.name}
                      </div>
                    ))}
                  </div>

                  {(() => {
                    const history = getExerciseHistory(records, item.name);
                    if (!item.name.trim()) return null;
                    return (
                      <div style={{
                        margin:"0 14px 10px",
                        padding:"9px 11px",
                        borderRadius:8,
                        background:"color-mix(in srgb,var(--accent2) 7%,var(--surface))",
                        border:"1px solid color-mix(in srgb,var(--accent2) 25%,transparent)",
                        fontSize:12,
                        color:"var(--muted)",
                        lineHeight:1.5,
                      }}>
                        {history ? (
                          <>
                            <div style={{ color:"var(--accent2)", fontWeight:700, marginBottom:2 }}>
                              최근 {formatDate(history.date)}
                            </div>
                            <div>{formatSetsSummary(history.sets) || "세트 정보 없음"}</div>
                            <div style={{ marginTop:2 }}>
                              최고 무게 <span style={{ color:"var(--text)", fontWeight:700 }}>{history.bestWeight || "-"}kg</span>
                              <span style={{ marginLeft:8 }}>볼륨 {(history.volume || 0).toLocaleString()}</span>
                            </div>
                          </>
                        ) : (
                          <span>이 운동은 첫 기록이에요.</span>
                        )}
                      </div>
                    );
                  })()}

                  {/* 세트 입력 */}
                  <div className="sets-header" style={{ padding:"0 14px" }}>
                    <span>횟수</span><span>무게(kg)</span><span></span>
                  </div>
                  {item.sets.map((s, j) => (
                    <div key={j} className="set-row" style={{ padding:"0 14px" }}>
                      <input type="number" min="0" placeholder={`${j+1}세트 횟수`}
                        value={s.reps} onChange={e => updItemSet(item.id,j,"reps",e.target.value)} />
                      <input type="number" min="0" placeholder="무게"
                        value={s.weight} onChange={e => updItemSet(item.id,j,"weight",e.target.value)} />
                      <button className="icon-btn" onClick={() => removeItemSet(item.id,j)}
                        disabled={item.sets.length===1}>×</button>
                    </div>
                  ))}
                  <div style={{ padding:"8px 14px 14px" }}>
                    <button className="btn btn-ghost" style={{ fontSize:12, padding:"6px 14px" }}
                      onClick={() => addItemSet(item.id)}>+ 세트 추가</button>
                  </div>
                </div>
              ))}

              {/* 종목 추가 버튼 */}
              <button className="btn btn-ghost" style={{ width:"100%", marginBottom:12 }}
                onClick={addSessionItem}>
                ＋ 운동 종목 추가
              </button>

              {/* 세션 저장 */}
              <button className="btn btn-primary" onClick={saveSession}>
                💾 세션 전체 저장
              </button>
              {formMsg && <div className="form-msg">{formMsg}</div>}
            </>
          )}

          {/* ──────────── 식단 탭 ──────────── */}
          {tab === "diet" && (
            <>
              <div className="card">
                <div className="card-title">식단 분석</div>

                {/* 날짜 */}
                <label>날짜</label>
                <input type="date" value={dietDate} onChange={e => setDietDate(e.target.value)} />

                {/* 이미지 업로드 영역 */}
                <input
                  ref={dietInputRef}
                  type="file" accept="image/*" capture="environment"
                  style={{ display: "none" }}
                  onChange={handleImageSelect}
                />
                <div
                  className={`diet-upload-area ${dietImagePreview ? "has-image" : ""}`}
                  onClick={() => dietInputRef.current?.click()}
                >
                  {dietImagePreview ? (
                    <>
                      <img src={dietImagePreview} alt="식단 사진" className="upload-preview" />
                      <div className="upload-overlay">
                        <span className="upload-overlay-text">📷 사진 변경</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="upload-icon">📸</div>
                      <div className="upload-hint">
                        식단 사진을 <strong>탭하여 업로드</strong>하세요<br />
                        AI가 칼로리와 영양소를 자동 분석해요
                      </div>
                    </>
                  )}
                </div>

                <button
                  className="btn btn-primary"
                  onClick={analyzeDiet}
                  disabled={!dietImage || dietAnalyzing}
                >
                  {dietAnalyzing ? "🔍 분석 중..." : "🤖 AI 칼로리 분석"}
                </button>
              </div>

              {/* 분석 중 스피너 */}
              {dietAnalyzing && (
                <div className="card">
                  <div className="analyzing-wrap">
                    <div className="spinner" />
                    <div className="analyzing-text">식단을 인식하고 있어요...</div>
                  </div>
                </div>
              )}

              {/* 오류 */}
              {dietError && <div className="error-msg">❌ {dietError}</div>}

              {/* 분석 결과 */}
              {dietResult && (
                <div className="analysis-card">
                  {/* 헤더: 식사 타입 + 건강 점수 */}
                  <div className="analysis-header">
                    <div className="meal-type-badge">
                      {getMealEmoji(dietResult.mealType)} {dietResult.mealType}
                    </div>
                    <div className="health-score" style={{ color: getScoreColor(dietResult.healthScore) }}>
                      건강점수 {dietResult.healthScore}/10
                      <div className="score-bar-wrap">
                        <div className="score-bar" style={{ width: `${dietResult.healthScore * 10}%`, background: getScoreColor(dietResult.healthScore) }} />
                      </div>
                    </div>
                  </div>

                  {/* 총 영양소 */}
                  <div className="macro-grid">
                    <div className="macro-item">
                      <div className="macro-val" style={{ color: "var(--accent)" }}>{dietResult.total?.calories}</div>
                      <div className="macro-unit">kcal</div>
                      <div className="macro-label">칼로리</div>
                    </div>
                    <div className="macro-item">
                      <div className="macro-val" style={{ color: "#ff8c45" }}>{dietResult.total?.protein}g</div>
                      <div className="macro-label">단백질</div>
                    </div>
                    <div className="macro-item">
                      <div className="macro-val" style={{ color: "var(--accent2)" }}>{dietResult.total?.carbs}g</div>
                      <div className="macro-label">탄수화물</div>
                    </div>
                    <div className="macro-item">
                      <div className="macro-val" style={{ color: "#c084fc" }}>{dietResult.total?.fat}g</div>
                      <div className="macro-label">지방</div>
                    </div>
                  </div>

                  {/* 음식별 목록 */}
                  <div className="food-list">
                    {dietResult.foods?.map((f, i) => (
                      <div key={i} className="food-row">
                        <div>
                          <div className="food-name">{f.name}</div>
                          <div className="food-amount">{f.amount}</div>
                        </div>
                        <div className="food-kcal">{f.calories} kcal</div>
                      </div>
                    ))}
                  </div>

                  {/* 코칭 코멘트 */}
                  {dietResult.comment && (
                    <div className="diet-comment">{dietResult.comment}</div>
                  )}

                  {/* 저장 버튼 */}
                  <div style={{ padding: "12px 16px" }}>
                    <button className="btn btn-save" onClick={saveDietRecord}>
                      💾 식단 기록 저장
                    </button>
                  </div>
                </div>
              )}

              {/* 오늘 식단 요약 */}
              {dietRecords.filter(d => d.date === today()).length > 0 && (
                <div className="card" style={{ marginTop: 4 }}>
                  <div className="card-title" style={{ fontSize: 14 }}>오늘 섭취 합계</div>
                  {(() => {
                    const todayRecs = dietRecords.filter(d => d.date === today());
                    const sum = todayRecs.reduce((a, d) => ({
                      calories: a.calories + (d.total?.calories || 0),
                      protein: a.protein + (d.total?.protein || 0),
                      carbs: a.carbs + (d.total?.carbs || 0),
                      fat: a.fat + (d.total?.fat || 0),
                    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
                    return (
                      <div className="macro-grid" style={{ padding: 0, paddingTop: 4 }}>
                        <div className="macro-item"><div className="macro-val" style={{ color: "var(--accent)" }}>{sum.calories}</div><div className="macro-label">kcal</div></div>
                        <div className="macro-item"><div className="macro-val" style={{ color: "#ff8c45" }}>{sum.protein}g</div><div className="macro-label">단백질</div></div>
                        <div className="macro-item"><div className="macro-val" style={{ color: "var(--accent2)" }}>{sum.carbs}g</div><div className="macro-label">탄수화물</div></div>
                        <div className="macro-item"><div className="macro-val" style={{ color: "#c084fc" }}>{sum.fat}g</div><div className="macro-label">지방</div></div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}

          {/* ──────────── 차트 탭 ──────────── */}
          {tab === "chart" && <ChartTab records={records} dietRecords={dietRecords} />}

          {/* ──────────── 뱃지 탭 ──────────── */}
          {tab === "badge" && (
            <BadgeTab allBadges={ALL_BADGES} earnedIds={earnedIds} streak={streak} records={records} />
          )}

          {/* ──────────── 루틴 탭 ──────────── */}
          {tab === "routine" && (
            <RoutineTab
              routines={routines}
              setRoutines={setRoutines}
              routineMsg={routineMsg}
              setRoutineMsg={setRoutineMsg}
              onLoad={(routine) => {
                const items = routine.exercises.map(ex => ({
                  id: Date.now() + Math.random(),
                  name: ex.name,
                  muscle: ex.muscle,
                  sets: ex.sets?.length ? ex.sets : [{reps:"",weight:""}],
                }));
                setSessionItems(items);
                setTab("log");
              }}
            />
          )}

          {/* ──────────── 프로필 탭 ──────────── */}
          {tab === "profile" && (
            <ProfileTab
              draft={profileDraft} setDraft={setProfileDraft}
              saved={profileSaved}
              onSave={() => {
                setProfile(profileDraft);
                setProfileSaved(true);
                setTimeout(() => setProfileSaved(false), 2200);
              }}
            />
          )}

          {/* ──────────── 주간플랜 탭 ──────────── */}
          {tab === "plan" && (
            <WeekPlanTab
              routines={routines}
              weekPlan={weekPlan}
              setWeekPlan={setWeekPlan}
            />
          )}

          {/* ──────────── 히스토리 탭 ──────────── */}
          {tab === "history" && (
            <HistoryTab
              records={records}
              dietRecords={dietRecords}
              deleteRecord={deleteRecord}
              filterMuscle={filterMuscle}
              setFilterMuscle={setFilterMuscle}
            />
          )}

          {/* ──────────── AI 코치 탭 ──────────── */}
          {tab === "chat" && (
            <div className="chat-wrap">
              <div className="quick-prompts">
                {["내 기록 분석해줘", "오늘 루틴 추천", "식단 피드백 해줘", "회복 필요해?"].map(p => (
                  <button key={p} className="qp-btn" onClick={() => setInput(p)}>{p}</button>
                ))}
              </div>
              <div className="chat-msgs">
                {messages.map((m, i) => (
                  <div key={i} className={`msg-row ${m.role}`}>
                    <div className="msg-avatar">{m.role === "assistant" ? "🤖" : "👤"}</div>
                    <div className="msg-bubble" dangerouslySetInnerHTML={{
                      __html: m.content
                        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                        .replace(/\*(.*?)\*/g, "<em>$1</em>")
                        .replace(/^[-•] (.+)$/gm, "▸ $1")
                    }} />
                  </div>
                ))}
                {chatLoading && (
                  <div className="msg-row assistant">
                    <div className="msg-avatar">🤖</div>
                    <div className="msg-bubble">
                      <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-input-row">
                <textarea
                  className="chat-input"
                  placeholder="트레이너에게 물어보세요..."
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  rows={1}
                />
                <button className="send-btn" onClick={sendMessage} disabled={chatLoading || !input.trim()}>➤</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
// ChartTab 컴포넌트
const ACCENT   = "#b8ff45";
const ACCENT2  = "#45ffd4";
const PURPLE   = "#c084fc";
const ORANGE   = "#ff8c45";
const MUTED_C  = "#6b6b85";
const PERIODS  = [
  { label: "2주",  days: 14   },
  { label: "1달",  days: 30   },
  { label: "3달",  days: 90   },
  { label: "전체", days: 9999 },
];
const RADAR_MUSCLES = ["가슴","등","어깨","팔","하체","복근"];

function CustomTooltipVolume({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ct">
      <div className="ct-label">{label}</div>
      {payload.map((p,i) => (
        <div key={i} className="ct-row" style={{ color: p.color }}>
          {p.name}: <span>{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function ChartTab({ records, dietRecords }) {
  const [period,      setPeriod]      = useState(30);
  const [chartMuscle, setChartMuscle] = useState("전체");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - period);

  const filteredRecs = records.filter(r => new Date(r.date) >= cutoff);

  // ① 일별 볼륨 라인차트
  const volumeByDate = {};
  filteredRecs.forEach(r => {
    if (chartMuscle !== "전체" && r.muscle !== chartMuscle) return;
    volumeByDate[r.date] = (volumeByDate[r.date] || 0) + r.volume;
  });
  const volumeData = Object.entries(volumeByDate)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, volume]) => ({
      date: new Date(date).toLocaleDateString("ko-KR", { month:"numeric", day:"numeric" }),
      볼륨: volume,
    }));

  // ② 근육별 빈도 바차트
  const muscleCount = {};
  filteredRecs.forEach(r => { muscleCount[r.muscle] = (muscleCount[r.muscle]||0) + 1; });
  const muscleData = Object.entries(muscleCount)
    .sort(([,a],[,b]) => b-a)
    .map(([muscle, count]) => ({ muscle, 횟수: count }));

  // ③ 레이더 (밸런스)
  const radarData = RADAR_MUSCLES.map(m => ({
    muscle: m,
    운동수: filteredRecs.filter(r => r.muscle === m).length,
  }));

  // ④ 칼로리 바차트
  const filteredDiet = dietRecords.filter(d => new Date(d.date) >= cutoff);
  const kcalByDate   = {};
  filteredDiet.forEach(d => {
    if (!kcalByDate[d.date]) kcalByDate[d.date] = { 칼로리: 0, 단백질: 0 };
    kcalByDate[d.date].칼로리  += d.total?.calories || 0;
    kcalByDate[d.date].단백질  += d.total?.protein  || 0;
  });
  const kcalData = Object.entries(kcalByDate)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date: new Date(date).toLocaleDateString("ko-KR", { month:"numeric", day:"numeric" }),
      ...v,
    }));

  // 요약
  const totalVol    = filteredRecs.reduce((s,r) => s + r.volume, 0);
  const workoutDays = new Set(filteredRecs.map(r => r.date)).size;
  const avgVol      = workoutDays ? Math.round(totalVol / workoutDays) : 0;
  const fmtK        = v => v > 999 ? (v/1000).toFixed(1)+"k" : v;

  return (
    <div style={{ paddingBottom: 20 }}>

      {/* 기간 선택 */}
      <div className="chart-filter-row">
        {PERIODS.map(p => (
          <button key={p.label} className={`period-btn ${period===p.days?"active":""}`}
            onClick={() => setPeriod(p.days)}>{p.label}</button>
        ))}
      </div>

      {/* 요약 카드 */}
      <div className="summary-row">
        <div className="summary-card">
          <div className="summary-val" style={{ color: ACCENT }}>{workoutDays}</div>
          <div className="summary-label">운동일</div>
        </div>
        <div className="summary-card">
          <div className="summary-val" style={{ color: ACCENT2, fontSize: totalVol>9999?16:22 }}>{fmtK(totalVol)}</div>
          <div className="summary-label">총 볼륨</div>
        </div>
        <div className="summary-card">
          <div className="summary-val" style={{ color: ORANGE, fontSize: avgVol>9999?16:22 }}>{fmtK(avgVol)}</div>
          <div className="summary-label">일평균 볼륨</div>
        </div>
      </div>

      {/* ① 볼륨 추이 */}
      <div className="chart-section">
        <div className="chart-section-title">
          📈 볼륨 추이 <span>부위 필터</span>
        </div>
        <div className="muscle-select-row">
          {["전체",...RADAR_MUSCLES,"유산소"].map(m => (
            <button key={m} className={`muscle-btn ${chartMuscle===m?"active":""}`}
              onClick={() => setChartMuscle(m)}>{m}</button>
          ))}
        </div>
        <div className="chart-box">
          {volumeData.length === 0
            ? <div className="no-data">기간 내 운동 기록이 없어요 🏋️</div>
            : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={volumeData} margin={{ top:4, right:12, left:-20, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                  <XAxis dataKey="date" tick={{ fill:MUTED_C, fontSize:10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill:MUTED_C, fontSize:10 }} tickLine={false} axisLine={false}
                    tickFormatter={v => v>=1000?(v/1000).toFixed(0)+"k":v} />
                  <Tooltip content={<CustomTooltipVolume />} />
                  <Line type="monotone" dataKey="볼륨" stroke={ACCENT} strokeWidth={2.5}
                    dot={{ fill:ACCENT, r:3, strokeWidth:0 }} activeDot={{ r:5, fill:ACCENT }} />
                </LineChart>
              </ResponsiveContainer>
            )
          }
        </div>
      </div>

      {/* ② 근육별 빈도 */}
      <div className="chart-section">
        <div className="chart-section-title">💪 근육군별 운동 빈도</div>
        <div className="chart-box">
          {muscleData.length === 0
            ? <div className="no-data">기간 내 운동 기록이 없어요 🏋️</div>
            : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={muscleData} margin={{ top:4, right:12, left:-20, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" vertical={false} />
                  <XAxis dataKey="muscle" tick={{ fill:MUTED_C, fontSize:11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill:MUTED_C, fontSize:10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltipVolume />} />
                  <Bar dataKey="횟수" fill={ACCENT2} radius={[4,4,0,0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )
          }
        </div>
      </div>

      {/* ③ 밸런스 레이더 */}
      <div className="chart-section">
        <div className="chart-section-title">🎯 근육 밸런스 레이더</div>
        <div className="chart-box">
          {radarData.every(d => d.운동수 === 0)
            ? <div className="no-data">기간 내 운동 기록이 없어요 🏋️</div>
            : (
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={radarData} margin={{ top:10, right:20, left:20, bottom:10 }}>
                  <PolarGrid stroke="#2a2a3a" />
                  <PolarAngleAxis dataKey="muscle" tick={{ fill:MUTED_C, fontSize:11 }} />
                  <Radar name="운동수" dataKey="운동수" stroke={PURPLE} fill={PURPLE} fillOpacity={0.25} strokeWidth={2} />
                  <Tooltip content={<CustomTooltipVolume />} />
                </RadarChart>
              </ResponsiveContainer>
            )
          }
        </div>
      </div>

      {/* ④ 칼로리 (식단 데이터 있을 때만) */}
      {kcalData.length > 0 && (
        <div className="chart-section">
          <div className="chart-section-title">🍱 칼로리 & 단백질 추이</div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={kcalData} margin={{ top:4, right:12, left:-20, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" vertical={false} />
                <XAxis dataKey="date" tick={{ fill:MUTED_C, fontSize:10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill:MUTED_C, fontSize:10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltipVolume />} />
                <Legend wrapperStyle={{ fontSize:11, color:MUTED_C, paddingTop:8 }} />
                <Bar dataKey="칼로리" fill={ACCENT}  radius={[3,3,0,0]} maxBarSize={28} />
                <Bar dataKey="단백질" fill={ORANGE}  radius={[3,3,0,0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

    </div>
  );
}
// ProfileTab 컴포넌트
const GOALS = [
  { key:"근비대",    icon:"💪", desc:"근육량 증가 & 체형 개선" },
  { key:"다이어트",  icon:"🔥", desc:"체지방 감소 & 체중 감량" },
  { key:"체력향상",  icon:"⚡", desc:"지구력 & 퍼포먼스 향상" },
  { key:"건강유지",  icon:"🧘", desc:"현재 상태 유지 & 웰빙" },
];
const LEVELS = ["입문", "초급", "중급", "고급"];
const GENDERS = ["남성", "여성"];
const DAYS    = ["2", "3", "4", "5", "6"];

function calcBMI(h, w) {
  const hm = Number(h) / 100;
  if (!hm || !Number(w)) return null;
  return (Number(w) / (hm * hm)).toFixed(1);
}
function bmiLabel(bmi) {
  if (!bmi) return null;
  const b = Number(bmi);
  if (b < 18.5) return { label:"저체중", color:"#45ffd4" };
  if (b < 23)   return { label:"정상",   color:"#b8ff45" };
  if (b < 25)   return { label:"과체중", color:"#ffd045" };
  return              { label:"비만",   color:"#ff4560" };
}
function calcTargetKcal(draft) {
  const w = Number(draft.weight), h = Number(draft.height), y = Number(draft.birthYear);
  if (!w || !h || !y) return null;
  const age = new Date().getFullYear() - y;
  const bmr = draft.gender === "남성"
    ? 88.4 + 13.4 * w + 4.8 * h - 5.7 * age
    : 447.6 + 9.25 * w + 3.1 * h - 4.3 * age;
  const actMult = { "2":1.2, "3":1.375, "4":1.55, "5":1.725, "6":1.9 }[draft.weeklyDays] || 1.375;
  const tdee = Math.round(bmr * actMult);
  if (draft.goal === "다이어트")  return { tdee, target: tdee - 400, label:"감량" };
  if (draft.goal === "근비대")   return { tdee, target: tdee + 300, label:"벌크" };
  return { tdee, target: tdee, label:"유지" };
}

function ProfileTab({ draft, setDraft, saved, onSave }) {
  const upd = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));
  const bmi   = calcBMI(draft.height, draft.weight);
  const bmiL  = bmiLabel(bmi);
  const kcal  = calcTargetKcal(draft);
  const proteinTarget = draft.weight ? Math.round(Number(draft.weight) * (draft.goal === "근비대" ? 2.0 : 1.6)) : null;

  return (
    <div style={{ paddingBottom: 30 }}>

      {/* 프로필 헤더 미리보기 */}
      {(draft.name || draft.weight) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="profile-avatar-row">
            <div className="profile-avatar">
              {draft.gender === "여성" ? "👩" : "🧑"}
            </div>
            <div>
              <div className="profile-name-big">{draft.name || "이름 없음"}</div>
              <div className="profile-sub">
                {draft.goal} · {draft.level} · 주 {draft.weeklyDays}회
              </div>
              {bmi && bmiL && (
                <span className="profile-bmi" style={{ background: `color-mix(in srgb, ${bmiL.color} 18%, transparent)`, color: bmiL.color, border: `1px solid color-mix(in srgb, ${bmiL.color} 40%, transparent)` }}>
                  BMI {bmi} · {bmiL.label}
                </span>
              )}
            </div>
          </div>

          {/* 목표 칼로리 & 단백질 */}
          {kcal && (
            <div className="target-info-box">
              <div className="target-info-row">
                <span className="target-info-label">기초대사량 (BMR)</span>
                <span className="target-info-val">{Math.round(kcal.tdee / ({"2":1.2,"3":1.375,"4":1.55,"5":1.725,"6":1.9}[draft.weeklyDays]||1.375))} kcal</span>
              </div>
              <div className="target-info-row">
                <span className="target-info-label">일일 소비 (TDEE)</span>
                <span className="target-info-val">{kcal.tdee} kcal</span>
              </div>
              <div className="target-info-row">
                <span className="target-info-label">목표 섭취 ({kcal.label})</span>
                <span className="target-info-val" style={{ color:"var(--accent)" }}>{kcal.target} kcal</span>
              </div>
              {proteinTarget && (
                <div className="target-info-row">
                  <span className="target-info-label">권장 단백질</span>
                  <span className="target-info-val" style={{ color:"#ff8c45" }}>{proteinTarget} g/일</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─ 기본 정보 ─ */}
      <div className="card">
        <div className="section-divider">기본 정보</div>

        <label>이름 / 닉네임</label>
        <input type="text" placeholder="예: 헬창김씨" value={draft.name} onChange={e => upd("name", e.target.value)} />

        <label>성별</label>
        <div className="radio-group">
          {GENDERS.map(g => (
            <button key={g} className={`radio-btn ${draft.gender === g ? "active" : ""}`} onClick={() => upd("gender", g)}>{g}</button>
          ))}
        </div>

        <div className="two-col">
          <div>
            <label>출생연도</label>
            <input type="number" placeholder="예: 1995" value={draft.birthYear} onChange={e => upd("birthYear", e.target.value)} />
          </div>
          <div>
            <label>주 운동일수</label>
            <div className="radio-group" style={{ marginBottom: 0 }}>
              {DAYS.map(d => (
                <button key={d} className={`radio-btn ${draft.weeklyDays === d ? "active" : ""}`}
                  style={{ padding:"5px 10px", fontSize:12 }}
                  onClick={() => upd("weeklyDays", d)}>{d}회</button>
              ))}
            </div>
          </div>
        </div>

        <div className="section-divider">신체 정보</div>
        <div className="two-col">
          <div>
            <label>키 (cm)</label>
            <input type="number" placeholder="175" value={draft.height} onChange={e => upd("height", e.target.value)} />
          </div>
          <div>
            <label>현재 체중 (kg)</label>
            <input type="number" placeholder="70" value={draft.weight} onChange={e => upd("weight", e.target.value)} />
          </div>
        </div>
        <label>목표 체중 (kg, 선택)</label>
        <input type="number" placeholder="65" value={draft.targetWeight} onChange={e => upd("targetWeight", e.target.value)} />
      </div>

      {/* ─ 운동 목표 ─ */}
      <div className="card">
        <div className="section-divider">운동 목표</div>
        <div className="goal-cards">
          {GOALS.map(g => (
            <div key={g.key} className={`goal-card ${draft.goal === g.key ? "active" : ""}`}
              onClick={() => upd("goal", g.key)}>
              <div className="goal-card-icon">{g.icon}</div>
              <div className="goal-card-label">{g.key}</div>
              <div className="goal-card-desc">{g.desc}</div>
            </div>
          ))}
        </div>

        <div className="section-divider">운동 경력</div>
        <div className="radio-group">
          {LEVELS.map(l => (
            <button key={l} className={`radio-btn ${draft.level === l ? "active-blue radio-btn" : ""}`}
              onClick={() => upd("level", l)}>{l}</button>
          ))}
        </div>

        <label>트레이너에게 한 마디 (메모)</label>
        <textarea placeholder="부상 이력, 집중하고 싶은 부위, 기타 요청사항..." value={draft.memo} onChange={e => upd("memo", e.target.value)} />

        <button className="btn btn-primary" onClick={onSave}>💾 프로필 저장</button>
        {saved && <div className="save-success">✅ 프로필이 저장됐어요! AI 코치가 이제 내 정보를 알아요 💪</div>}
      </div>
    </div>
  );
}
// BadgeTab 컴포넌트
function BadgeTab({ allBadges, earnedIds, streak, records }) {
  const earned = allBadges.filter(b => earnedIds.has(b.id));
  const locked  = allBadges.filter(b => !earnedIds.has(b.id));
  const pct = Math.round((earned.length / allBadges.length) * 100);

  // 최근 28일 달력 데이터
  const workedDays = new Set(records.map(r => r.date));
  const calDays = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const str = d.toISOString().slice(0, 10);
    calDays.push({ str, worked: workedDays.has(str), day: d.getDate() });
  }
  const DOW = ["일","월","화","수","목","금","토"];

  return (
    <div style={{ paddingBottom: 24 }}>

      {/* 히어로 섹션 */}
      <div className="badge-hero">
        <div className="badge-hero-streak">{streak > 0 ? streak : "0"}</div>
        <div className="badge-hero-label">🔥 현재 연속 운동 일수</div>
        {streak === 0 && <div className="badge-hero-sub">오늘 운동하고 스트릭을 시작하세요!</div>}
        {streak >= 3  && <div className="badge-hero-sub">대단해요! 이 기세 이어가요 💪</div>}

        {/* 뱃지 달성률 바 */}
        <div className="badge-progress-row">
          <div className="badge-progress-label">뱃지 달성</div>
          <div className="badge-progress-bar">
            <div className="badge-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="badge-progress-label">{earned.length}/{allBadges.length} ({pct}%)</div>
        </div>
      </div>

      {/* 최근 28일 캘린더 */}
      <div className="card">
        <div className="card-title" style={{ fontSize: 14, marginBottom: 10 }}>📅 최근 28일 기록</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
          {DOW.map(d => <div key={d} className="cal-label">{d}</div>)}
        </div>
        <div className="streak-calendar">
          {calDays.map(d => (
            <div key={d.str} className={`cal-day ${d.worked ? "worked" : "rest"}`}>
              {d.day}
            </div>
          ))}
        </div>
        <div style={{ marginTop:10, fontSize:11, color:"var(--muted)", display:"flex", gap:14 }}>
          <span>🟩 운동함</span><span>⬜ 쉰 날</span>
        </div>
      </div>

      {/* 획득한 뱃지 */}
      {earned.length > 0 && (
        <>
          <div className="badge-section-title">✅ 획득한 뱃지 ({earned.length})</div>
          <div className="badge-grid">
            {earned.map(b => (
              <div key={b.id} className="badge-card earned">
                <div className="badge-earned-mark">달성!</div>
                <div className="badge-icon">{b.icon}</div>
                <div className="badge-name">{b.label}</div>
                <div className="badge-desc">{b.desc}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 잠긴 뱃지 */}
      {locked.length > 0 && (
        <>
          <div className="badge-section-title">🔒 도전 중인 뱃지 ({locked.length})</div>
          <div className="badge-grid">
            {locked.map(b => (
              <div key={b.id} className="badge-card locked">
                <div className="badge-icon">{b.icon}</div>
                <div className="badge-name">{b.label}</div>
                <div className="badge-desc">{b.desc}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
// RoutineTab 컴포넌트
const PRESET_ROUTINES = [
  {
    name: "가슴 집중 루틴", icon: "🏋️", goal: "근비대", level: "중급",
    exercises: [
      { name:"벤치프레스",       muscle:"가슴", sets:[{reps:"10",weight:"80"},{reps:"8",weight:"85"},{reps:"6",weight:"90"}] },
      { name:"인클라인 덤벨프레스", muscle:"가슴", sets:[{reps:"12",weight:"30"},{reps:"10",weight:"32"},{reps:"8",weight:"34"}] },
      { name:"딥스",             muscle:"가슴", sets:[{reps:"12",weight:""},{reps:"10",weight:""},{reps:"8",weight:""}] },
      { name:"케이블 플라이",    muscle:"가슴", sets:[{reps:"15",weight:"15"},{reps:"12",weight:"17"},{reps:"12",weight:"17"}] },
    ]
  },
  {
    name: "하체 파워 루틴", icon: "🦵", goal: "근비대", level: "중급",
    exercises: [
      { name:"스쿼트",    muscle:"하체", sets:[{reps:"10",weight:"100"},{reps:"8",weight:"110"},{reps:"6",weight:"120"},{reps:"6",weight:"120"}] },
      { name:"레그프레스", muscle:"하체", sets:[{reps:"12",weight:"180"},{reps:"10",weight:"200"},{reps:"8",weight:"220"}] },
      { name:"런지",      muscle:"하체", sets:[{reps:"12",weight:"20"},{reps:"12",weight:"20"},{reps:"10",weight:"22"}] },
      { name:"레그컬",    muscle:"하체", sets:[{reps:"15",weight:"50"},{reps:"12",weight:"55"},{reps:"12",weight:"55"}] },
    ]
  },
  {
    name: "등 & 이두 루틴", icon: "💪", goal: "근비대", level: "초급",
    exercises: [
      { name:"풀업",        muscle:"등", sets:[{reps:"8",weight:""},{reps:"6",weight:""},{reps:"6",weight:""}] },
      { name:"바벨로우",    muscle:"등", sets:[{reps:"10",weight:"60"},{reps:"8",weight:"65"},{reps:"8",weight:"65"}] },
      { name:"시티드로우",  muscle:"등", sets:[{reps:"12",weight:"55"},{reps:"10",weight:"60"},{reps:"10",weight:"60"}] },
      { name:"바벨컬",     muscle:"팔", sets:[{reps:"12",weight:"30"},{reps:"10",weight:"32"},{reps:"10",weight:"32"}] },
    ]
  },
  {
    name: "전신 다이어트 루틴", icon: "🔥", goal: "다이어트", level: "초급",
    exercises: [
      { name:"버피",      muscle:"유산소", sets:[{reps:"20",weight:""},{reps:"20",weight:""},{reps:"20",weight:""}] },
      { name:"스쿼트",    muscle:"하체",   sets:[{reps:"15",weight:""},{reps:"15",weight:""},{reps:"15",weight:""}] },
      { name:"푸시업",    muscle:"가슴",   sets:[{reps:"15",weight:""},{reps:"12",weight:""},{reps:"12",weight:""}] },
      { name:"플랭크",    muscle:"복근",   sets:[{reps:"60초",weight:""},{reps:"60초",weight:""},{reps:"60초",weight:""}] },
    ]
  },
];

const MUSCLE_OPTS = ["가슴","등","어깨","팔","하체","복근","유산소"];

function emptyExercise() {
  return { name:"", muscle:"가슴", sets:[{reps:"",weight:""}] };
}

function RoutineTab({ routines, setRoutines, onLoad }) {
  const [mode, setMode]         = useState("list"); // list | create
  const [routineName, setRName] = useState("");
  const [routineGoal, setRGoal] = useState("근비대");
  const [routineLevel, setRLevel]= useState("초급");
  const [exercises, setExercises]= useState([emptyExercise()]);
  const [saved, setSaved]        = useState("");
  const [expanded, setExpanded]  = useState(null);

  const addExercise = () => setExercises(p => [...p, emptyExercise()]);
  const removeExercise = i => setExercises(p => p.filter((_,idx)=>idx!==i));
  const updEx = (i, k, v) => setExercises(p => { const n=[...p]; n[i]={...n[i],[k]:v}; return n; });
  const addExSet = i => setExercises(p => { const n=[...p]; n[i]={...n[i],sets:[...n[i].sets,{reps:"",weight:""}]}; return n; });
  const removeExSet = (i,j) => setExercises(p => { const n=[...p]; n[i]={...n[i],sets:n[i].sets.filter((_,idx)=>idx!==j)}; return n; });
  const updExSet = (i,j,k,v) => setExercises(p => { const n=[...p]; const s=[...n[i].sets]; s[j]={...s[j],[k]:v}; n[i]={...n[i],sets:s}; return n; });

  const saveRoutine = () => {
    if (!routineName.trim()) { setSaved("❌ 루틴 이름을 입력하세요."); setTimeout(()=>setSaved(""),2000); return; }
    const exs = exercises.filter(e=>e.name.trim());
    if (!exs.length) { setSaved("❌ 운동을 1개 이상 추가하세요."); setTimeout(()=>setSaved(""),2000); return; }
    const newR = { id:Date.now(), name:routineName.trim(), goal:routineGoal, level:routineLevel, exercises:exs, icon:"📋" };
    setRoutines(p=>[newR,...p]);
    setSaved("✅ 루틴이 저장됐어요!"); setTimeout(()=>setSaved(""),2000);
    setRName(""); setExercises([emptyExercise()]); setMode("list");
  };

  const deleteRoutine = id => setRoutines(p=>p.filter(r=>r.id!==id));

  const addPreset = preset => {
    setRoutines(p => {
      if (p.find(r=>r.name===preset.name)) return p;
      return [{ ...preset, id:Date.now() }, ...p];
    });
    setSaved(`✅ "${preset.name}" 프리셋 추가됐어요!`); setTimeout(()=>setSaved(""),2000);
  };

  const allRoutines = routines;

  if (mode === "create") return (
    <div className="pb-24">
      <div className="routine-form">
        <div className="card-title">새 루틴 만들기</div>

        <label>루틴 이름</label>
        <input type="text" placeholder="예: 월요일 가슴 루틴" value={routineName} onChange={e=>setRName(e.target.value)} />

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div>
            <label>목표</label>
            <select value={routineGoal} onChange={e=>setRGoal(e.target.value)} style={{marginBottom:0}}>
              {["근비대","다이어트","체력향상","건강유지"].map(g=><option key={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label>레벨</label>
            <select value={routineLevel} onChange={e=>setRLevel(e.target.value)} style={{marginBottom:0}}>
              {["입문","초급","중급","고급"].map(l=><option key={l}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>

      {exercises.map((ex, i) => (
        <div key={i} className="routine-ex-builder">
          <div className="ex-builder-top">
            <span style={{ fontSize:13, color:"var(--accent)", letterSpacing:1 }}>운동 {i+1}</span>
            <ImeTextInput className="ex-builder-name" placeholder="운동 이름 (예: 벤치프레스)"
              value={ex.name} onValueChange={value=>updEx(i,"name",value)}
              style={{ width:"100%", minWidth:0, marginBottom:0 }} />
            {exercises.length > 1 && (
              <button className="mini-icon-btn" onClick={()=>removeExercise(i)}>×</button>
            )}
          </div>
          <select className="muscle-select-sm" value={ex.muscle} onChange={e=>updEx(i,"muscle",e.target.value)}
            style={{ marginBottom:8 }}>
            {MUSCLE_OPTS.map(m=><option key={m}>{m}</option>)}
          </select>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 28px", gap:6, marginBottom:4 }}>
            <span style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>횟수</span>
            <span style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>무게(kg)</span>
            <span/>
          </div>
          {ex.sets.map((s,j)=>(
            <div key={j} className="ex-set-row">
              <input className="ex-set-input" type="text" placeholder={`${j+1}세트 횟수`}
                value={s.reps} onChange={e=>updExSet(i,j,"reps",e.target.value)} />
              <input className="ex-set-input" type="number" placeholder="무게"
                value={s.weight} onChange={e=>updExSet(i,j,"weight",e.target.value)} />
              <button className="mini-icon-btn" onClick={()=>removeExSet(i,j)} disabled={ex.sets.length===1}>×</button>
            </div>
          ))}
          <button className="btn btn-ghost" style={{padding:"5px 12px",fontSize:11,marginTop:4}}
            onClick={()=>addExSet(i)}>+ 세트 추가</button>
        </div>
      ))}

      <button className="btn btn-ghost" style={{width:"100%",marginBottom:14}} onClick={addExercise}>
        + 운동 추가
      </button>
      <div className="flex-10">
        <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setMode("list")}>취소</button>
        <button className="btn btn-primary" style={{flex:2,marginTop:0}} onClick={saveRoutine}>💾 루틴 저장</button>
      </div>
      {saved && <div className="routine-saved-msg">{saved}</div>}
    </div>
  );

  return (
    <div className="pb-24">
      {/* 상단 버튼 */}
      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        <button className="btn btn-primary" style={{flex:1,marginTop:0}} onClick={()=>setMode("create")}>
          ✏️ 새 루틴 만들기
        </button>
      </div>

      {/* 프리셋 추가 */}
      <div className="card" style={{marginBottom:16}}>
        <div className="card-title" style={{fontSize:14,marginBottom:10}}>🎁 프리셋 루틴 추가</div>
        <div className="preset-chips">
          {PRESET_ROUTINES.map(p=>(
            <button key={p.name} className="preset-chip" onClick={()=>addPreset(p)}>
              {p.icon} {p.name}
            </button>
          ))}
        </div>
        <div style={{fontSize:11,color:"var(--muted)"}}>탭하면 내 루틴 목록에 바로 추가돼요</div>
      </div>

      {saved && <div className="routine-saved-msg" style={{marginBottom:12}}>{saved}</div>}

      {/* 루틴 목록 */}
      {allRoutines.length === 0 ? (
        <div className="empty-routine">
          <div style={{fontSize:40,marginBottom:10}}>📋</div>
          <div style={{fontSize:14,lineHeight:1.6}}>
            저장된 루틴이 없어요.<br/>
            새 루틴을 만들거나 프리셋을 추가해보세요!
          </div>
        </div>
      ) : allRoutines.map(r => (
        <div key={r.id} className="routine-card">
          <div className="routine-header" onClick={()=>setExpanded(expanded===r.id?null:r.id)}>
            <div className="routine-icon">{r.icon}</div>
            <div style={{flex:1}}>
              <div className="routine-title">{r.name}</div>
              <div className="routine-meta">
                {r.level} · {r.goal} · 운동 {r.exercises?.length}종목
              </div>
            </div>
            <span style={{color:"var(--muted)",fontSize:18}}>{expanded===r.id?"▲":"▼"}</span>
          </div>

          {expanded===r.id && (
            <>
              <div className="routine-ex-list">
                {r.exercises?.map((ex,i)=>(
                  <div key={i} className="routine-ex-row">
                    <span className="routine-ex-name">{ex.name}</span>
                    <span className="routine-ex-muscle">{ex.muscle}</span>
                    <span className="routine-ex-sets">
                      {ex.sets?.length}세트 · {ex.sets?.[0]?.reps}회
                      {ex.sets?.[0]?.weight ? ` · ${ex.sets[0].weight}kg` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <div className="routine-actions">
                <button className="btn-load" onClick={()=>onLoad(r)}>
                  ▶ 이 루틴으로 오늘 운동 시작
                </button>
                <button className="btn-del-routine" onClick={()=>deleteRoutine(r.id)}>🗑</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
// WeekPlanTab 컴포넌트
const DOW_KO  = ["일","월","화","수","목","금","토"];
const DOW_FULL = ["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];

function WeekPlanTab({ routines, weekPlan, setWeekPlan }) {
  const todayDow = new Date().getDay();

  const setDay = (dow, routineId) =>
    setWeekPlan(p => ({ ...p, [String(dow)]: routineId || undefined }));

  // 최근 7일 피로도 데이터 (부모에서 records 없으니 localStorage에서 직접)
  const recentFatigue = (() => {
    try {
      const recs = JSON.parse(localStorage.getItem("fm_records") || "[]");
      const map = {};
      recs.slice(0, 14).forEach(r => { if (r.fatigue) map[r.date] = r.fatigue; });
      return map;
    } catch { return {}; }
  })();

  const last7 = Array.from({length:7}, (_,i) => {
    const d = new Date(Date.now() - (6-i)*86400000);
    return { date: d.toISOString().slice(0,10), dow: d.getDay(), label: DOW_KO[d.getDay()] };
  });

  return (
    <div className="pb-24">

      {/* 주간 플랜 설정 */}
      <div className="card">
        <div className="card-title">주간 운동 플랜</div>
        {routines.length === 0 && (
          <div style={{ fontSize:13, color:"var(--muted)", marginBottom:14, padding:"10px 0" }}>
            💡 루틴 탭에서 루틴을 먼저 만들어야 배치할 수 있어요.
          </div>
        )}
        <div className="week-grid">
          {DOW_KO.map((label, dow) => {
            const isToday = dow === todayDow;
            const assignedId = weekPlan[String(dow)];
            const assignedRoutine = routines.find(r => r.id === assignedId);
            return (
              <div key={dow} className={`week-row ${isToday?"today":""}`}>
                <div>
                  <div className="week-day-label">{label}</div>
                  <div className="week-day-full">{DOW_FULL[dow]}</div>
                </div>
                {routines.length > 0 ? (
                  <select className="week-routine-select" value={assignedId||""}
                    onChange={e => setDay(dow, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— 휴식일 —</option>
                    {routines.map(r => (
                      <option key={r.id} value={r.id}>{r.icon} {r.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="week-routine-pill" style={{ color:"var(--muted)", background:"var(--surface)" }}>
                    루틴 없음
                  </div>
                )}
                {isToday && <span className="week-today-badge">오늘</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 이번 주 요약 */}
      <div className="card">
        <div className="card-title" style={{fontSize:14,marginBottom:12}}>📊 이번 주 컨디션 추이</div>
        {last7.every(d => !recentFatigue[d.date]) ? (
          <div style={{fontSize:13,color:"var(--muted)",textAlign:"center",padding:"16px 0"}}>
            아직 컨디션 기록이 없어요.<br/>운동 세션을 저장하면 여기에 표시돼요!
          </div>
        ) : (
          <div className="week-fatigue-chart">
            {last7.map(d => {
              const f = recentFatigue[d.date];
              const colors = ["#6b6b85","#ff4560","#ffd045","#b8ff45","#45ffd4"];
              const isToday = d.dow === todayDow && d.date === new Date().toISOString().slice(0,10);
              return (
                <div key={d.date} className="wf-bar-row">
                  <span style={{width:20,textAlign:"center",fontWeight:isToday?700:400,
                    color:isToday?"var(--accent)":"var(--muted)"}}>{d.label}</span>
                  <div className="wf-bar-wrap">
                    {f ? <div className="wf-bar-fill" style={{width:`${f*20}%`, background:colors[f-1]}}/> : null}
                  </div>
                  <span style={{width:36,textAlign:"right"}}>
                    {f ? ["😴","😓","😐","😊","💪"][f-1] : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
// HistoryTab 컴포넌트 (달력 + 리스트 뷰)
const DOW_LABELS = ["일","월","화","수","목","금","토"];
const FATIGUE_COLORS = ["#6b6b85","#ff4560","#ffd045","#b8ff45","#45ffd4"];

function SessionCard({ r, onDelete }) {
  return (
    <div className="rec-card">
      <div className="rec-top">
        <div>
          <div className="rec-name">
            {r.exercises
              ? `${r.exercises.map(e=>e.name).slice(0,2).join(" · ")}${r.exercises.length>2?` 외 ${r.exercises.length-2}종목`:""}`
              : r.name}
          </div>
          <div className="rec-date">{formatDate(r.date)}</div>
        </div>
        <div className="flex-center-8">
          <span className="muscle-tag">
            {r.exercises ? `${r.exercises.length}종목` : r.muscle}
          </span>
          <button className="del-btn" onClick={() => onDelete(r.id)}>🗑</button>
        </div>
      </div>
      {r.exercises ? r.exercises.map((ex,ei) => (
        <div key={ei} className="mb-6">
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            <span style={{ fontSize:12, fontWeight:700, color:"var(--text)" }}>{ex.name}</span>
            <span className="muscle-tag" style={{ fontSize:10 }}>{ex.muscle}</span>
          </div>
          <div className="rec-sets">
            {ex.sets.map((s,si) => (
              <span key={si} className="set-pill">
                {si+1}세트 {s.reps}회{s.weight ? ` × ${s.weight}kg` : ""}
              </span>
            ))}
          </div>
        </div>
      )) : (
        <div className="rec-sets">
          {r.sets?.map((s,i) => (
            <span key={i} className="set-pill">{i+1}세트 {s.reps}회{s.weight ? ` × ${s.weight}kg` : ""}</span>
          ))}
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:4 }}>
        <div className="rec-volume">총 볼륨: <span>{(r.totalVolume||r.volume||0).toLocaleString()}</span></div>
        {r.fatigue && (
          <span className="fatigue-tag">
            {["😴","😓","😐","😊","💪"][r.fatigue-1]} 컨디션 {r.fatigue}/5
          </span>
        )}
      </div>
      {r.note && <div className="rec-note">💬 {r.note}</div>}
    </div>
  );
}

function HistoryTab({ records, dietRecords, deleteRecord, filterMuscle, setFilterMuscle }) {
  const [view, setView]           = useState("calendar"); // calendar | list
  const [calYear, setCalYear]     = useState(new Date().getFullYear());
  const [calMonth, setCalMonth]   = useState(new Date().getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState(null);

  const todayStr = new Date().toISOString().slice(0,10);

  // 날짜별 세션 맵
  const recordsByDate = {};
  records.forEach(r => {
    if (!recordsByDate[r.date]) recordsByDate[r.date] = [];
    recordsByDate[r.date].push(r);
  });

  // 달력 셀 생성
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();
  const cells = [];
  // 이전달 채우기
  for (let i = firstDay-1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth-i, cur: false, dateStr: null });
  }
  // 이번달
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    cells.push({ day: d, cur: true, dateStr });
  }
  // 다음달 채우기 (6주 맞춤)
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, cur: false, dateStr: null });
  }

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(y=>y-1); setCalMonth(11); }
    else setCalMonth(m=>m-1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear(y=>y+1); setCalMonth(0); }
    else setCalMonth(m=>m+1);
    setSelectedDate(null);
  };

  const selectedRecs = selectedDate ? (recordsByDate[selectedDate] || []) : [];
  const selectedDietRecs = selectedDate ? dietRecords.filter(d => d.date === selectedDate) : [];

  // 리스트 필터
  const filtered = filterMuscle === "전체"
    ? records
    : records.filter(r => r.exercises?.some(e => e.muscle === filterMuscle));

  const MONTH_NAMES = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

  return (
    <div className="pb-24">
      {/* 뷰 전환 */}
      <div className="hist-view-toggle">
        <button className={`view-btn ${view==="calendar"?"active":""}`} onClick={()=>setView("calendar")}>
          📅 달력 뷰
        </button>
        <button className={`view-btn ${view==="list"?"active":""}`} onClick={()=>setView("list")}>
          📋 리스트 뷰
        </button>
      </div>

      {/* ── 달력 뷰 ── */}
      {view === "calendar" && (
        <>
          {/* 월 네비게이션 */}
          <div className="card" style={{ marginBottom:12 }}>
            <div className="cal-nav">
              <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
              <div className="cal-month-label">{calYear}년 {MONTH_NAMES[calMonth]}</div>
              <button className="cal-nav-btn" onClick={nextMonth}>›</button>
            </div>

            {/* 요일 헤더 */}
            <div className="cal-dow-row">
              {DOW_LABELS.map(d => (
                <div key={d} className="cal-dow-cell" style={{ color: d==="일"?"#ff4560": d==="토"?"#45ffd4":"var(--muted)" }}>
                  {d}
                </div>
              ))}
            </div>

            {/* 달력 그리드 */}
            <div className="cal-grid">
              {cells.map((cell, i) => {
                const hasRec = cell.cur && cell.dateStr && recordsByDate[cell.dateStr];
                const isToday = cell.dateStr === todayStr;
                const isSelected = cell.dateStr === selectedDate;
                const fatigue = hasRec ? hasRec[0]?.fatigue : null;
                return (
                  <div
                    key={i}
                    className={[
                      "cal-cell",
                      !cell.cur ? "other-month" : "",
                      hasRec ? "has-record" : "",
                      isToday ? "today" : "",
                      isSelected ? "selected" : "",
                    ].join(" ")}
                    onClick={() => cell.cur && cell.dateStr && setSelectedDate(
                      selectedDate === cell.dateStr ? null : cell.dateStr
                    )}
                  >
                    {cell.day}
                    {hasRec && !isSelected && (
                      <div className="cal-dot" />
                    )}
                    {fatigue && !isSelected && (
                      <div className="cal-fatigue-dot"
                        style={{ background: FATIGUE_COLORS[fatigue-1] }} />
                    )}
                  </div>
                );
              })}
            </div>

          </div>

          {/* 선택된 날짜 상세 */}
          {selectedDate && (
            <div className="card">
              <div className="day-detail-header">
                <div className="day-detail-date">
                  {new Date(selectedDate+"T00:00:00").toLocaleDateString("ko-KR", { month:"long", day:"numeric", weekday:"long" })}
                </div>
                <button className="del-btn" style={{ fontSize:18 }} onClick={()=>setSelectedDate(null)}>✕</button>
              </div>

              {selectedRecs.length === 0 && selectedDietRecs.length === 0 ? (
                <div className="day-detail-empty">이 날은 기록이 없어요 😴</div>
              ) : (
                <>
                  {/* 운동 세션 */}
                  {selectedRecs.length > 0 && (
                    <>
                      <div style={{ fontSize:11, fontWeight:700, color:"var(--accent)", letterSpacing:1, marginBottom:8 }}>
                        💪 운동 세션
                      </div>
                      {selectedRecs.map(r => (
                        <SessionCard key={r.id} r={r} onDelete={deleteRecord} />
                      ))}
                    </>
                  )}

                  {/* 식단 기록 */}
                  {selectedDietRecs.length > 0 && (
                    <>
                      <div style={{ fontSize:11, fontWeight:700, color:"var(--accent2)", letterSpacing:1, margin:"12px 0 8px" }}>
                        🍱 식단 기록
                      </div>
                      {selectedDietRecs.map(d => (
                        <div key={d.id} className="diet-hist-card" style={{ marginBottom:8 }}>
                          <div className="diet-hist-top">
                            {d.imagePreview
                              ? <img src={d.imagePreview} className="diet-thumb" alt="" />
                              : <div className="diet-thumb-placeholder">{getMealEmoji(d.mealType)}</div>
                            }
                            <div className="diet-hist-info">
                              <div className="diet-hist-name">{getMealEmoji(d.mealType)} {d.mealType}</div>
                              <div className="diet-hist-meta">건강점수 {d.healthScore}/10</div>
                            </div>
                            <div style={{ textAlign:"right" }}>
                              <div className="diet-hist-kcal">{d.total?.calories}</div>
                              <div className="fs-10-muted">kcal</div>
                            </div>
                          </div>
                          <div className="diet-macro-row">
                            <div className="diet-macro-chip">단백질 <span>{d.total?.protein}g</span></div>
                            <div className="diet-macro-chip">탄수화물 <span>{d.total?.carbs}g</span></div>
                            <div className="diet-macro-chip">지방 <span>{d.total?.fat}g</span></div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* 이번 달 요약 */}
          {(() => {
            const monthStr = `${calYear}-${String(calMonth+1).padStart(2,"0")}`;
            const monthRecs = records.filter(r => r.date.startsWith(monthStr));
            const monthDiet = dietRecords.filter(d => d.date.startsWith(monthStr));
            if (!monthRecs.length && !monthDiet.length) return null;
            const totalVol = monthRecs.reduce((s,r)=>s+(r.totalVolume||0),0);
            const totalKcal = monthDiet.reduce((s,d)=>s+(d.total?.calories||0),0);
            return (
              <div className="card">
                <div className="card-title" style={{ fontSize:14, marginBottom:12 }}>
                  {MONTH_NAMES[calMonth]} 요약
                </div>
                <div className="summary-row">
                  <div className="summary-card">
                    <div className="summary-val" style={{ color:"var(--accent)" }}>{monthRecs.length}</div>
                    <div className="summary-label">운동 세션</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-val" style={{ color:"var(--accent2)", fontSize:totalVol>9999?16:22 }}>
                      {totalVol>999?(totalVol/1000).toFixed(1)+"k":totalVol}
                    </div>
                    <div className="summary-label">총 볼륨</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-val" style={{ color:"#ff8c45", fontSize:totalKcal>9999?16:22 }}>
                      {totalKcal>999?(totalKcal/1000).toFixed(1)+"k":totalKcal||"-"}
                    </div>
                    <div className="summary-label">총 칼로리</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* ── 리스트 뷰 ── */}
      {view === "list" && (
        <>
          <div className="filter-bar">
            {MUSCLE_GROUPS.map(m => (
              <div key={m} className={`chip ${filterMuscle===m?"active":""}`}
                onClick={() => setFilterMuscle(m)}>{m}</div>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">🏋️</div>
              <div className="empty-text">아직 기록이 없어요.<br/>기록 탭에서 운동을 추가해보세요!</div>
            </div>
          ) : (
            filtered.map(r => <SessionCard key={r.id} r={r} onDelete={deleteRecord} />)
          )}

          {/* 식단 히스토리 */}
          {dietRecords.length > 0 && (
            <>
              <div style={{ fontSize:15, letterSpacing:1.5, color:"var(--accent2)", margin:"20px 0 12px" }}>
                식단 기록
              </div>
              {dietRecords.map(d => (
                <div key={d.id} className="diet-hist-card">
                  <div className="diet-hist-top">
                    {d.imagePreview
                      ? <img src={d.imagePreview} className="diet-thumb" alt="" />
                      : <div className="diet-thumb-placeholder">{getMealEmoji(d.mealType)}</div>
                    }
                    <div className="diet-hist-info">
                      <div className="diet-hist-name">{getMealEmoji(d.mealType)} {d.mealType}</div>
                      <div className="diet-hist-meta">{formatDate(d.date)}</div>
                      <div className="diet-hist-meta" style={{ marginTop:2, fontSize:11, color:"var(--muted)" }}>
                        건강점수 {d.healthScore}/10
                      </div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                      <div className="diet-hist-kcal">{d.total?.calories}</div>
                      <div className="fs-10-muted">kcal</div>
                    </div>
                  </div>
                  <div className="diet-macro-row">
                    <div className="diet-macro-chip">단백질 <span>{d.total?.protein}g</span></div>
                    <div className="diet-macro-chip">탄수화물 <span>{d.total?.carbs}g</span></div>
                    <div className="diet-macro-chip">지방 <span>{d.total?.fat}g</span></div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
