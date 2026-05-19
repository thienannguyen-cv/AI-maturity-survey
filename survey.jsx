/* eslint-disable */
// Survey app — preview build. Uses React + Recharts as globals.
// Artifact-ready version with proper imports is in Survey.jsx.

const { useState, useEffect, useMemo, useRef, useCallback } = React;
const {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} = Recharts;

// DATA reads through to window.SURVEY_DATA at access time so the async
// YAML loader can hydrate it after this script has parsed.
const DATA = new Proxy({}, {
  get: (_t, key) => window.SURVEY_DATA?.[key],
  has: (_t, key) => key in (window.SURVEY_DATA || {}),
  ownKeys: () => Object.keys(window.SURVEY_DATA || {}),
  getOwnPropertyDescriptor: (_t, key) => {
    if (!window.SURVEY_DATA) return undefined;
    return Object.getOwnPropertyDescriptor(window.SURVEY_DATA, key);
  },
});
const SESSION_KEY = 'ai-maturity:session';
const SHARED_KEY = 'ai-maturity:submissions';

/* -------- Email submission (Formspree) ------------------------------
 * To enable: create a free form at https://formspree.io, copy the form
 * ID from your dashboard URL (the part after `/forms/`), and paste it
 * below. Leave as the placeholder `null` to disable email submission —
 * the survey will still work, results stay local + downloadable.
 *
 * Free tier: 50 submissions / month. No signup needed beyond email.
 * Each submission arrives in your inbox with the full JSON payload.
 */
const FORMSPREE_FORM_ID = 'mqejaady'; // e.g. 'xayzwabc'  ← paste form ID here
const SUBMISSION_ENDPOINT = FORMSPREE_FORM_ID
  ? `https://formspree.io/f/${FORMSPREE_FORM_ID}`
  : null;

/**
 * DEPLOY flag — controls creator-only UI.
 *   false → preview/test mode: bạn (người tạo survey) tự bấm thử, thấy mọi section
 *           gồm cả "Đáng xem lại" (false-high signals dành cho người phân tích).
 *   true  → production: người tham gia thật. Ẩn các section nội bộ (signals…) khỏi
 *           ResultScreen, nhưng VẪN gửi đầy đủ warnings trong email payload.
 * Đổi cờ này khi chuyển môi trường; không cần đổi gì khác.
 */
const DEPLOY = false;

/* ------------------------- storage wrapper -------------------------- */
// window.storage in Claude artifacts; localStorage fallback for preview.
const storage = {
  async get(key, shared = false) {
    try {
      if (window.storage?.getItem) {
        const v = await window.storage.getItem(key, { shared });
        return v ?? null;
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem(`__poly:${shared ? 'shared:' : ''}${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  async set(key, value, shared = false) {
    try {
      if (window.storage?.setItem) {
        await window.storage.setItem(key, value, { shared });
        return;
      }
    } catch (e) {}
    try { localStorage.setItem(`__poly:${shared ? 'shared:' : ''}${key}`, JSON.stringify(value)); } catch (e) {}
  },
  async remove(key, shared = false) {
    try {
      if (window.storage?.removeItem) { await window.storage.removeItem(key, { shared }); return; }
    } catch (e) {}
    try { localStorage.removeItem(`__poly:${shared ? 'shared:' : ''}${key}`); } catch (e) {}
  },
};

/* ------------------------- utilities -------------------------------- */
function makeSessionId() {
  return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seededShuffle(arr, seed) {
  const r = [...arr];
  let s = seed || 1;
  for (let i = r.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function tierFor(percent) {
  return DATA.tiers.find(t => percent >= t.min && percent <= t.max) || DATA.tiers[0];
}
function getGroup(groupId) {
  return (DATA.groups || []).find(g => g.id === groupId) || null;
}
function getQuestionWeight(question) {
  const raw = Number(question?.weight ?? DATA.scoring?.default_weight ?? 1);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}
function getOptionScore(option) {
  const raw = Number(option?.score ?? option?.level ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}
function getMaxRawScore(question) {
  const scores = (question?.options || []).map(getOptionScore);
  return scores.length ? Math.max(...scores) : Number(DATA.scoring?.scale_max || 5);
}
function hasQuestionChoice(answer) {
  return !!answer && (answer.isNA === true || Number.isFinite(Number(answer.level)));
}
function formatScore(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

/* ------------------------- icons (inline SVG, Lucide-equiv) -------- */
const Icon = ({ d, children, size = 18, stroke = 1.75, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden="true">
    {children || (d ? <path d={d} /> : null)}
  </svg>
);
const InfoIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></Icon>;
const ChevronLeft = (p) => <Icon {...p} d="M15 18l-6-6 6-6" />;
const ChevronRight = (p) => <Icon {...p} d="M9 18l6-6-6-6" />;
const Check = (p) => <Icon {...p} d="M20 6L9 17l-5-5" />;
const Download = (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Icon>;
const RotateCcw = (p) => <Icon {...p}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></Icon>;
const Sun = (p) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Icon>;
const Moon = (p) => <Icon {...p} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
const SaveIcon = (p) => <Icon {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></Icon>;
const AlertTri = (p) => <Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></Icon>;
const X = (p) => <Icon {...p} d="M18 6L6 18M6 6l12 12" />;
const Sparkle = (p) => <Icon {...p}><path d="M12 3l1.9 5.5L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.5z" /></Icon>;

/* ============================ APP ================================== */
function Survey() {
  // bootstrapping: load saved session
  const [booted, setBooted] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [stage, setStage] = useState('welcome'); // welcome | demo | question | result
  const [demoIndex, setDemoIndex] = useState(0); // 0..1
  const [qIndex, setQIndex] = useState(0);
  const [demographics, setDemographics] = useState({});
  const [answers, setAnswers] = useState({});     // {qId: {level, score, originalIndex, isNA, comment}}
  const [dark, setDark] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [slideDir, setSlideDir] = useState(1);
  const [submitState, setSubmitState] = useState('idle'); // idle | sending | sent | error | skipped
  const [submitError, setSubmitError] = useState(null);
  const savedTimer = useRef(null);

  // boot
  useEffect(() => {
    (async () => {
      const saved = await storage.get(SESSION_KEY);
      const themeSaved = await storage.get('ai-maturity:theme');
      if (themeSaved === 'dark' || (!themeSaved && window.matchMedia?.('(prefers-color-scheme: dark)').matches)) {
        setDark(true);
      }
      if (saved && saved.sessionId && saved.stage && saved.stage !== 'result') {
        // Offer resume
        setSessionId(saved.sessionId);
        setDemographics(saved.demographics || {});
        setAnswers(saved.answers || {});
        setStage('welcome');
        setDemoIndex(saved.demoIndex || 0);
        setQIndex(saved.qIndex || 0);
        setShowResume(true);
      } else {
        setSessionId(makeSessionId());
      }
      setBooted(true);
    })();
  }, []);

  // theme apply
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    if (booted) storage.set('ai-maturity:theme', dark ? 'dark' : 'light');
  }, [dark, booted]);

  // persist
  const persist = useCallback(async (overrides = {}) => {
    if (!sessionId) return;
    const snapshot = {
      sessionId, stage, demoIndex, qIndex, demographics, answers,
      ...overrides,
      updatedAt: new Date().toISOString(),
    };
    await storage.set(SESSION_KEY, snapshot);
    // flash
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedFlash(true);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 1400);
  }, [sessionId, stage, demoIndex, qIndex, demographics, answers]);

  /* ---------- handlers ---------- */
  const startFresh = async () => {
    const sid = makeSessionId();
    setSessionId(sid);
    setDemographics({});
    setAnswers({});
    setDemoIndex(0);
    setQIndex(0);
    setShowResume(false);
    setStage('demo');
    setSlideDir(1);
    await storage.set(SESSION_KEY, { sessionId: sid, stage: 'demo', demoIndex: 0, qIndex: 0, demographics: {}, answers: {}, updatedAt: new Date().toISOString() });
  };
  const resume = () => {
    setShowResume(false);
    if (qIndex > 0 || Object.keys(answers).length > 0) setStage('question');
    else if (Object.keys(demographics).length > 0) setStage('demo');
    else setStage('demo');
  };

  const setDemoAnswer = (id, value) => {
    const next = { ...demographics, [id]: value };
    setDemographics(next);
    persist({ demographics: next });
  };
  const setAnswer = (qId, payload) => {
    const next = { ...answers, [qId]: payload };
    setAnswers(next);
    persist({ answers: next });
  };

  const goNext = () => {
    setSlideDir(1);
    if (stage === 'demo') {
      if (demoIndex < DATA.demographics.length - 1) { setDemoIndex(demoIndex + 1); persist({ demoIndex: demoIndex + 1 }); }
      else { setStage('question'); setQIndex(0); persist({ stage: 'question', qIndex: 0 }); }
    } else if (stage === 'question') {
      if (qIndex < DATA.questions.length - 1) { setQIndex(qIndex + 1); persist({ qIndex: qIndex + 1 }); }
      else { submit(); }
    }
  };
  const goBack = () => {
    setSlideDir(-1);
    if (stage === 'question') {
      if (qIndex > 0) { setQIndex(qIndex - 1); persist({ qIndex: qIndex - 1 }); }
      else { setStage('demo'); setDemoIndex(DATA.demographics.length - 1); persist({ stage: 'demo', demoIndex: DATA.demographics.length - 1 }); }
    } else if (stage === 'demo') {
      if (demoIndex > 0) { setDemoIndex(demoIndex - 1); persist({ demoIndex: demoIndex - 1 }); }
      else { setStage('welcome'); persist({ stage: 'welcome' }); }
    }
  };

  const sendToEndpoint = useCallback(async (submission) => {
    if (!SUBMISSION_ENDPOINT) { setSubmitState('skipped'); return; }
    setSubmitState('sending');
    setSubmitError(null);
    try {
      // Flat top-level fields make the email digest easy to scan;
      // full payload goes as a stringified field too.
      const summary = submission.summary;
      const body = {
        participant_id: submission.sessionId,
        submitted_at: submission.submittedAt,
        tier: summary.tier.name,
        total_score: formatScore(summary.total),
        max_score: formatScore(summary.maxScore),
        percent_score: summary.percent.toFixed(1),
        applicable_questions: `${summary.applicableCount}/${summary.totalQuestions}`,
        role: submission.demographics?.a1 || '(không trả lời)',
        team_size: submission.demographics?.a2 || '(không trả lời)',
        project_age: submission.demographics?.a3 || '(không trả lời)',
        ai_scope: submission.demographics?.a4 || '(không trả lời)',
        domain_risk: submission.demographics?.a5 || '(không trả lời)',
        delivery_baseline: submission.demographics?.a6 || '(không trả lời)',
        warnings_count: summary.warnings.length,
        warnings: summary.warnings.map(w => `${w.title} [${w.refs.map(r => 'Q' + r).join(', ')}]`).join(' · '),
        open_responses_count: submission.openResponses.length,
        open_responses: submission.openResponses.map(r => `Q${r.questionId}: ${r.comment}`).join('\n---\n'),
        _subject: `AI Maturity · ${summary.tier.name} (${summary.percent.toFixed(0)}%) · ${submission.sessionId.slice(0, 12)}`,
        full_payload_json: JSON.stringify(submission),
      };
      const res = await fetch(SUBMISSION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ' · ' + detail.slice(0, 120) : ''}`);
      }
      // Remember we sent this session so retry button doesn't double-send accidentally.
      await storage.set(`ai-maturity:sent:${submission.sessionId}`, true);
      setSubmitState('sent');
    } catch (err) {
      console.error('[survey] submission failed:', err);
      setSubmitError(err?.message || String(err));
      setSubmitState('error');
    }
  }, []);

  const submit = async () => {
    const submission = buildSubmission(sessionId, demographics, answers);
    // Local shared storage (works even when endpoint is disabled/down)
    const prev = (await storage.get(SHARED_KEY, true)) || [];
    const list = Array.isArray(prev) ? prev : [];
    list.push(submission);
    await storage.set(SHARED_KEY, list, true);

    // Move to result screen immediately — don't make the user wait on network
    setStage('result');
    persist({ stage: 'result' });

    // Fire-and-forget the network submission
    sendToEndpoint(submission);
  };

  const retrySubmit = useCallback(() => {
    const submission = buildSubmission(sessionId, demographics, answers);
    sendToEndpoint(submission);
  }, [sessionId, demographics, answers, sendToEndpoint]);

  const restart = async () => {
    await storage.remove(SESSION_KEY);
    const sid = makeSessionId();
    setSessionId(sid);
    setDemographics({});
    setAnswers({});
    setDemoIndex(0);
    setQIndex(0);
    setShowResume(false);
    setSlideDir(1);
    setSubmitState('idle');
    setSubmitError(null);
    setStage('welcome');
  };

  /* ---------- derived ---------- */
  const totalSteps = DATA.demographics.length + DATA.questions.length;
  const currentStep =
    stage === 'welcome' ? 0
    : stage === 'demo' ? demoIndex + 1
    : stage === 'question' ? DATA.demographics.length + qIndex + 1
    : totalSteps;

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (stage === 'question' || stage === 'demo') {
        if (e.key === 'ArrowRight' || e.key === 'Enter') {
          const canAdvance = stage === 'demo'
            ? !!demographics[DATA.demographics[demoIndex].id]
            : hasQuestionChoice(answers[DATA.questions[qIndex].id]);
          if (canAdvance) { e.preventDefault(); goNext(); }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault(); goBack();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, demoIndex, qIndex, demographics, answers]);

  if (!booted) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink/40">
        <div className="text-sm font-mono tracking-wide">đang tải…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink antialiased">
      <Header dark={dark} onToggleDark={() => setDark(d => !d)} />

      <main className="flex-1 w-full">
        {stage === 'welcome' && (
          <WelcomeScreen
            endpointEnabled={!!SUBMISSION_ENDPOINT}
            onStart={startFresh}
            onResume={showResume ? resume : null}
            resumePosition={
              stage === 'welcome' && showResume
                ? (qIndex > 0 || Object.keys(answers).length > 0
                    ? `Câu ${qIndex + 1} / ${DATA.questions.length}`
                    : `Phần bối cảnh ${demoIndex + 1}/${DATA.demographics.length}`)
                : null
            }
          />
        )}

        {(stage === 'demo' || stage === 'question') && (
          <ProgressBar current={currentStep} total={totalSteps} />
        )}

        <div className="w-full max-w-2xl mx-auto px-5 sm:px-8 pb-32">
          {/* welcome rendered above */}
          {stage === 'demo' && (
            <SlideTransition keyName={'demo-' + demoIndex} dir={slideDir}>
              <DemographicScreen
                step={demoIndex}
                spec={DATA.demographics[demoIndex]}
                value={demographics[DATA.demographics[demoIndex].id]}
                onChange={(v) => setDemoAnswer(DATA.demographics[demoIndex].id, v)}
                onNext={goNext}
                onBack={goBack}
              />
            </SlideTransition>
          )}

          {stage === 'question' && (
            <SlideTransition keyName={'q-' + qIndex} dir={slideDir}>
              <QuestionScreen
                sessionId={sessionId}
                index={qIndex}
                total={DATA.questions.length}
                question={DATA.questions[qIndex]}
                value={answers[DATA.questions[qIndex].id]}
                onChange={(payload) => setAnswer(DATA.questions[qIndex].id, payload)}
                onNext={goNext}
                onBack={goBack}
                isLast={qIndex === DATA.questions.length - 1}
              />
            </SlideTransition>
          )}

          {stage === 'result' && (
            <ResultScreen
              demographics={demographics}
              answers={answers}
              sessionId={sessionId}
              onRestart={restart}
              submitState={submitState}
              submitError={submitError}
              onRetry={retrySubmit}
              endpointEnabled={!!SUBMISSION_ENDPOINT}
              deploy={DEPLOY}
              dark={dark}
            />
          )}
        </div>
      </main>

      <SavedToast visible={savedFlash} />
    </div>
  );
}

/* ------------------------- header ----------------------------------- */
function Header({ dark, onToggleDark }) {
  return (
    <header className="w-full border-b border-line/60">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-ink text-paper flex items-center justify-center">
            <div className="w-3 h-3 border-2 border-paper" style={{ transform: 'rotate(45deg)' }} />
          </div>
          <div className="font-display text-[15px] leading-none tracking-tight">
            <div className="font-semibold">AI Maturity</div>
            <div className="text-[11px] text-muted font-mono mt-1 tracking-wider uppercase">v1.0 · cmmi 5-tier</div>
          </div>
        </div>
        <button
          onClick={onToggleDark}
          aria-label={dark ? 'Chế độ sáng' : 'Chế độ tối'}
          className="w-9 h-9 grid place-items-center rounded-sm border border-line text-muted hover:text-ink hover:border-ink/40 transition-colors"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}

/* ------------------------- progress -------------------------------- */
function ProgressBar({ current, total }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className="w-full border-b border-line/60">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-3 flex items-center gap-4">
        <div className="font-mono text-[11px] tracking-wider uppercase text-muted whitespace-nowrap">
          {String(current).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </div>
        <div className="flex-1 h-[3px] bg-line/60 rounded-full overflow-hidden">
          <div className="h-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <div className="font-mono text-[11px] tracking-wider uppercase text-muted whitespace-nowrap tabular-nums">
          {pct}%
        </div>
      </div>
    </div>
  );
}

/* ------------------------- slide transition ------------------------- */
function SlideTransition({ keyName, dir, children }) {
  // simple key-based CSS animation
  return (
    <div key={keyName} className="slide-in" style={{ '--dir': dir > 0 ? '20px' : '-20px' }}>
      {children}
    </div>
  );
}

/* ------------------------- welcome --------------------------------- */
function WelcomeScreen({ onStart, onResume, resumePosition, endpointEnabled }) {
  const demoCount = DATA.demographics?.length || 0;
  const questionCount = DATA.questions?.length || 0;
  const groupCount = DATA.groups?.length || 0;
  return (
    <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-32">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-6">
        Đánh giá nội bộ · ẩn danh
      </div>

      <h1 className="font-display font-medium text-[34px] sm:text-[44px] leading-[1.05] tracking-tight text-balance">
        Độ trưởng thành tích hợp AI<br/>
        <span className="text-muted">trong dự án phần mềm.</span>
      </h1>

      <p className="mt-8 text-[15px] sm:text-base leading-relaxed text-ink/80 max-w-xl">
        Bài đánh giá gồm <strong className="font-medium">{questionCount} câu maturity</strong> giúp bạn định vị
        dự án trên thang trưởng thành 5 mức (CMMI điều chỉnh cho AI-assisted development).
        Bạn sẽ nhận được điểm tổng theo trọng số, profile radar {groupCount} nhóm, và khuyến nghị cụ thể cho bước
        tiếp theo.
      </p>

      <dl className="mt-12 grid grid-cols-3 gap-4 sm:gap-8 border-t border-line/60 pt-8">
        <Stat label="Thời gian" value="~12 phút" />
        <Stat label="Câu hỏi" value={`${demoCount} + ${questionCount}`} />
        <Stat label="Lưu trữ" value="Ẩn danh" />
      </dl>

      <div className="mt-12 space-y-4">
        {onResume && (
          <div className="border border-accent/30 bg-accent-soft px-4 py-4 rounded-sm flex items-center justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-accent mb-1">Đã lưu phiên trước</div>
              <div className="text-sm">Bạn đang ở <strong className="font-medium">{resumePosition}</strong></div>
            </div>
            <button
              onClick={onResume}
              className="shrink-0 px-4 py-2 bg-ink text-paper text-sm font-medium rounded-sm hover:bg-ink/90 transition-colors"
            >
              Tiếp tục
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onStart}
            className="group flex-1 inline-flex items-center justify-between px-5 py-4 bg-ink text-paper rounded-sm hover:bg-ink/90 transition-colors"
          >
            <span className="font-medium">{onResume ? 'Bắt đầu lại từ đầu' : 'Bắt đầu đánh giá'}</span>
            <ChevronRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>

      <p className="mt-10 text-[12px] leading-relaxed text-muted max-w-xl">
        {endpointEnabled ? (
          <>
            Phản hồi được lưu cục bộ trên trình duyệt và (khi nộp) gửi về email người
            quản lý khảo sát kèm một mã session tự sinh để phân biệt người tham gia.
            Không thu thập tên, email, hay thông tin định danh từ bạn. Bạn có thể tạm dừng
            giữa chừng — tiến độ sẽ được khôi phục khi quay lại.
          </>
        ) : (
          <>
            Phản hồi của bạn được lưu cục bộ trên trình duyệt và (khi nộp) ghi ẩn danh
            vào kho dữ liệu tổng hợp. Không thu thập email hay thông tin định danh.
            Bạn có thể tạm dừng giữa chừng — tiến độ sẽ được khôi phục khi bạn quay lại.
          </>
        )}
      </p>
    </div>
  );
}
function Stat({ label, value }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">{label}</dt>
      <dd className="mt-1.5 text-[15px] sm:text-base font-medium">{value}</dd>
    </div>
  );
}

/* ------------------------- demographic ----------------------------- */
function DemographicScreen({ step, spec, value, onChange, onNext, onBack }) {
  return (
    <div className="pt-10 sm:pt-16">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-3">
        Phần A · Bối cảnh · {step + 1}/{DATA.demographics.length} <span className="text-ink/30">·</span> không tính điểm
      </div>
      <h2 className="font-display font-medium text-[24px] sm:text-[28px] leading-[1.2] tracking-tight text-balance mb-8">
        {spec.label}
      </h2>

      <fieldset className="space-y-2.5">
        <legend className="sr-only">{spec.label}</legend>
        {spec.options.map((opt, i) => {
          const selected = value === opt;
          return (
            <RadioRow
              key={i}
              checked={selected}
              onSelect={() => onChange(opt)}
              label={opt}
              name={'demo-' + spec.id}
            />
          );
        })}
      </fieldset>

      <NavRow
        onBack={onBack}
        onNext={onNext}
        canNext={!!value}
        nextLabel={step === DATA.demographics.length - 1 ? 'Bắt đầu phần đánh giá' : 'Tiếp theo'}
      />
    </div>
  );
}

/* ------------------------- question -------------------------------- */
function QuestionScreen({ sessionId, index, total, question, value, onChange, onNext, onBack, isLast }) {
  const [popover, setPopover] = useState(false);
  const group = getGroup(question.group);
  const openResponse = question.open_response || DATA.open_response || {};

  // Stable shuffle keyed by session + question id
  const shuffledOptions = useMemo(() => {
    const seed = hashStr(sessionId + ':q' + question.id);
    return seededShuffle(question.options.map((o, i) => ({ ...o, originalIndex: i })), seed);
  }, [sessionId, question.id]);

  const NA = {
    level: null,
    score: 0,
    text: DATA.scoring?.not_applicable?.label || 'Chưa áp dụng trong dự án',
    isNA: true,
  };
  const updateAnswer = (patch) => onChange({ ...(value || {}), ...patch });
  const hasChoice = hasQuestionChoice(value);

  return (
    <div className="pt-10 sm:pt-16">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Câu {index + 1} / {total} <span className="text-ink/30 mx-1">·</span> {question.short}
          </div>
          {group && (
            <div className="mt-2 inline-flex items-center gap-2 border border-line rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted bg-line/20">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent"></span>
              {group.name}
            </div>
          )}
        </div>
        <button
          onClick={() => setPopover(p => !p)}
          aria-label="Lưu ý phổ biến"
          aria-expanded={popover}
          className={`relative w-8 h-8 grid place-items-center rounded-full transition-colors ${popover ? 'bg-ink text-paper' : 'text-muted hover:text-ink hover:bg-line/40'}`}
        >
          <InfoIcon size={16} />
        </button>
      </div>

      <h2 className="font-display font-medium text-[22px] sm:text-[26px] leading-[1.25] tracking-tight text-balance">
        {question.text}
      </h2>

      {popover && (
        <div role="region" aria-label="Lưu ý phổ biến" className="mt-5 border-l-2 border-ink pl-4 py-2 bg-line/30 rounded-r-sm">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1.5 flex items-center justify-between">
            <span>Lưu ý phổ biến từ tác giả</span>
            <button onClick={() => setPopover(false)} className="text-muted hover:text-ink" aria-label="Đóng">
              <X size={12} />
            </button>
          </div>
          <p className="text-[13px] leading-relaxed text-ink/85">{question.note}</p>
        </div>
      )}

      <fieldset className="mt-8 space-y-2.5">
        <legend className="sr-only">{question.text}</legend>
        {shuffledOptions.map((opt, displayIdx) => {
          const selected = value && value.level === opt.level && value.originalIndex === opt.originalIndex && !value.isNA;
          return (
            <RadioRow
              key={opt.originalIndex}
              checked={selected}
              onSelect={() => updateAnswer({
                level: opt.level,
                score: getOptionScore(opt),
                originalIndex: opt.originalIndex,
                displayIndex: displayIdx,
                isNA: false,
              })}
              label={opt.text}
              name={'q-' + question.id}
            />
          );
        })}

        <div className="pt-3 mt-3 border-t border-dashed border-line">
          <RadioRow
            checked={value?.isNA === true}
            onSelect={() => updateAnswer({ level: null, score: 0, originalIndex: -1, displayIndex: -1, isNA: true })}
            label={NA.text}
            name={'q-' + question.id}
            muted
          />
        </div>
      </fieldset>

      {openResponse.enabled !== false && (
        <div className="mt-7">
          <label
            htmlFor={'comment-' + question.id}
            className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted mb-2"
          >
            {openResponse.label || 'Bổ sung bối cảnh (tuỳ chọn)'}
          </label>
          <textarea
            id={'comment-' + question.id}
            value={value?.comment || ''}
            onChange={(e) => updateAnswer({ comment: e.target.value })}
            placeholder={openResponse.placeholder || 'Thêm bối cảnh nếu cần.'}
            rows={3}
            className="w-full resize-y rounded-sm border border-line bg-paper px-4 py-3 text-[14px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-ink/50 transition-colors"
          />
        </div>
      )}

      <NavRow
        onBack={onBack}
        onNext={onNext}
        canNext={hasChoice}
        nextLabel={isLast ? 'Hoàn thành & xem kết quả' : 'Tiếp theo'}
      />
    </div>
  );
}

/* ------------------------- radio row ------------------------------- */
function RadioRow({ checked, onSelect, label, name, muted }) {
  return (
    <label
      className={`group flex items-start gap-3.5 px-4 py-3.5 sm:px-5 sm:py-4 border rounded-sm cursor-pointer transition-all select-none
        ${checked
          ? 'border-ink bg-accent-soft shadow-[0_0_0_3px_var(--c-accent-ring)]'
          : 'border-line hover:border-ink/40 hover:bg-line/30'}
        ${muted && !checked ? 'opacity-70 hover:opacity-100' : ''}
      `}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="sr-only peer"
      />
      <span
        className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 grid place-items-center transition-colors
          ${checked ? 'border-ink bg-ink' : 'border-line group-hover:border-ink/50'}`}
        aria-hidden="true"
      >
        {checked && <span className="w-2 h-2 rounded-full bg-paper" />}
      </span>
      <span className={`text-[14.5px] leading-[1.55] ${checked ? 'text-ink' : 'text-ink/85'}`}>
        {label}
      </span>
    </label>
  );
}

/* ------------------------- nav row --------------------------------- */
function NavRow({ onBack, onNext, canNext, nextLabel }) {
  return (
    <div className="mt-10 flex items-center justify-between gap-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm text-muted hover:text-ink transition-colors"
      >
        <ChevronLeft size={16} /> Quay lại
      </button>
      <button
        onClick={onNext}
        disabled={!canNext}
        className={`group inline-flex items-center gap-2 px-5 py-3 rounded-sm text-sm font-medium transition-all
          ${canNext
            ? 'bg-ink text-paper hover:bg-ink/90 active:scale-[0.99]'
            : 'bg-line/60 text-muted cursor-not-allowed'}`}
      >
        {nextLabel}
        <ChevronRight size={16} className={canNext ? 'transition-transform group-hover:translate-x-0.5' : ''} />
      </button>
    </div>
  );
}

/* ------------------------- saved toast ----------------------------- */
function SavedToast({ visible }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 transition-all duration-300
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
    >
      <div className="flex items-center gap-2 px-3.5 py-2 bg-ink text-paper text-[12px] font-medium rounded-full shadow-md">
        <SaveIcon size={13} stroke={2} />
        Đã lưu tiến độ
      </div>
    </div>
  );
}

/* ============================ RESULTS ============================== */
function computeSummary(answers, demographics) {
  const scored = DATA.questions.map(q => {
    const a = answers[q.id];
    const weight = getQuestionWeight(q);
    const possibleMax = getMaxRawScore(q) * weight;
    const answered = hasQuestionChoice(a);
    const isNA = a?.isNA === true;
    const rawScore = answered && !isNA ? Number(a.score ?? a.level ?? 0) : 0;
    const maxPoints = answered && !isNA ? possibleMax : 0;
    const points = answered && !isNA ? rawScore * weight : 0;
    return {
      id: q.id,
      group: q.group,
      topic: q.topic,
      short: q.short,
      weight,
      level: answered && !isNA ? Number(a.level) : null,
      rawScore,
      points,
      maxPoints,
      possibleMax,
      isNA,
      answered,
      comment: a?.comment || '',
    };
  });
  const total = scored.reduce((s, x) => s + x.points, 0);
  const maxScore = scored.reduce((s, x) => s + x.maxPoints, 0);
  const percent = maxScore > 0 ? (total / maxScore) * 100 : 0;
  const tier = tierFor(percent);
  const groupSummaries = computeGroupSummaries(scored);
  const warnings = computeWarnings(scored, demographics, { total, maxScore, percent, groupSummaries });
  const applicableCount = scored.filter(s => s.answered && !s.isNA).length;
  return {
    scored,
    total,
    maxScore,
    percent,
    tier,
    warnings,
    groupSummaries,
    applicableCount,
    totalQuestions: DATA.questions.length,
  };
}

function computeGroupSummaries(scored) {
  const groups = DATA.groups || [];
  return groups.map(group => {
    const items = scored.filter(s => s.group === group.id);
    const total = items.reduce((sum, item) => sum + item.points, 0);
    const maxScore = items.reduce((sum, item) => sum + item.maxPoints, 0);
    const percent = maxScore > 0 ? (total / maxScore) * 100 : 0;
    return {
      ...group,
      questionCount: items.length,
      applicableCount: items.filter(item => item.answered && !item.isNA).length,
      total,
      maxScore,
      percent,
      score: percent / 20,
    };
  });
}

function collectOpenResponses(answers) {
  return DATA.questions
    .map(q => ({
      questionId: q.id,
      group: q.group,
      topic: q.topic,
      comment: (answers[q.id]?.comment || '').trim(),
    }))
    .filter(r => r.comment);
}

function buildSubmission(sessionId, demographics, answers) {
  return {
    sessionId,
    submittedAt: new Date().toISOString(),
    demographics,
    answers, // anonymized — no PII collected
    openResponses: collectOpenResponses(answers),
    summary: computeSummary(answers, demographics),
  };
}

function computeWarnings(scored, demographics, summary) {
  const get = (id) => scored.find(s => s.id === id);
  const warnings = [];
  const q1 = get(1), q3 = get(3), q5 = get(5), q6 = get(6), q7 = get(7), q9 = get(9), q10 = get(10), q11 = get(11), q12 = get(12), q14 = get(14), q15 = get(15);

  if (q1?.level >= 4 && q11?.level != null && q11.level <= 2) {
    warnings.push({
      key: 'q1-q11',
      title: 'Ước lượng cao nhưng cost observability thấp',
      detail: 'Bạn tự đánh giá ước lượng đã trưởng thành (Câu 1) nhưng chưa track cost/token (Câu 11). Khả năng cao estimate đang dựa trực giác chứ không phải dữ liệu — đáng xem lại Câu 1.',
      refs: [1, 11],
    });
  }
  if (q1?.level >= 4 && ((q14?.level != null && q14.level <= 2) || (q15?.level != null && q15.level <= 2))) {
    warnings.push({
      key: 'q1-q14-q15',
      title: 'Estimate cao nhưng planning readiness thấp',
      detail: 'Ước lượng AI trưởng thành cần task slicing và definition of ready đủ rõ. Nếu Q14/Q15 thấp, estimate Phase 1 có thể vẫn đang dựa vào kỳ vọng hơn là điều kiện thực thi.',
      refs: [1, 14, 15],
    });
  }
  if (q14?.level >= 4 && q15?.level != null && q15.level <= 2) {
    warnings.push({
      key: 'q14-q15',
      title: 'Task slicing tốt nhưng readiness chưa đủ',
      detail: 'Backlog được chia cho AI khá tốt, nhưng trước khi agent chạy lại thiếu acceptance criteria/context/test command. Đây là nguồn rework phổ biến.',
      refs: [14, 15],
    });
  }
  if (q3?.level >= 4 && q10?.level != null && q10.level <= 2) {
    warnings.push({
      key: 'q3-q10',
      title: 'Phát hiện lỗi tốt nhưng chưa có eval framework',
      detail: 'Bạn xếp Câu 3 cao nhưng Câu 10 thấp. Phát hiện silent failure không có eval baseline thường là anecdote — đáng xem lại Câu 3.',
      refs: [3, 10],
    });
  }
  if (q6?.level >= 4 && q9?.level != null && q9.level <= 2) {
    warnings.push({
      key: 'q6-q9',
      title: 'Harness cao nhưng runtime security thấp',
      detail: 'Harness trưởng thành mà sandbox/permission còn yếu là rủi ro vận hành lớn. Nên xem lại quyền tool, secret và audit trail trước khi mở rộng agent.',
      refs: [6, 9],
    });
  }
  if (q7?.level >= 4 && q10?.level != null && q10.level <= 2) {
    warnings.push({
      key: 'q7-q10',
      title: 'Model selection cao nhưng eval thấp',
      detail: 'Chọn model theo task mà chưa có eval baseline dễ trở thành cảm tính nâng cao. Nên có bộ task nội bộ trước khi tin vào routing/model policy.',
      refs: [7, 10],
    });
  }
  const teamSmall = demographics.a2 === '1–3 người' || demographics.a2 === '4–10 người';
  const newProject = demographics.a3 === '<3 tháng';
  if (q5?.level >= 4 && teamSmall && newProject) {
    warnings.push({
      key: 'q5-context',
      title: 'Catalog skill enterprise cần thời gian tích lũy',
      detail: 'Bạn xếp Câu 5 ở mức cao nhưng team nhỏ và dự án mới <3 tháng. L4–L5 thường đòi hỏi accumulation lâu hơn — đáng xem lại Câu 5.',
      refs: [5],
    });
  }
  // Q12 L2 anti-pattern
  if (q12?.level === 2) {
    warnings.push({
      key: 'q12-l2',
      title: 'Parallel swarm thường là anti-pattern',
      detail: 'Câu 12 phương án bạn chọn (parallel swarm nhiều agent cùng ghi) thường tệ hơn single-agent về mặt chất lượng kiến trúc. Đây không phải bước tiến, mà là vùng cần nghiên cứu thêm.',
      refs: [12],
    });
  }
  const naCount = scored.filter(s => s.isNA).length;
  if (naCount >= 4) {
    warnings.push({
      key: 'many-na',
      title: 'Nhiều câu chưa áp dụng',
      detail: `Có ${naCount} câu được đánh dấu N/A nên điểm tối đa áp dụng đã giảm. Kết quả vẫn hợp lệ, nhưng nên đọc như snapshot phạm vi hiện tại chứ không phải maturity toàn diện.`,
      refs: scored.filter(s => s.isNA).map(s => s.id),
    });
  }
  return warnings;
}

function ResultScreen({ demographics, answers, sessionId, onRestart, submitState, submitError, onRetry, endpointEnabled, deploy, dark }) {
  const summary = useMemo(() => computeSummary(answers, demographics), [answers, demographics]);
  const { scored, total, maxScore, percent, tier, warnings, groupSummaries, applicableCount, totalQuestions } = summary;

  const radarData = groupSummaries.map(s => ({
    topic: s.short,
    fullTopic: s.name,
    score: s.score,
  }));

  const handleDownload = () => {
    const payload = {
      meta: {
        survey: 'AI Integration Maturity Survey v1.0',
        sessionId,
        submittedAt: new Date().toISOString(),
      },
      demographics,
      responses: DATA.questions.map(q => {
        const a = answers[q.id];
        const selectedOption = Number.isInteger(a?.originalIndex) && a.originalIndex >= 0
          ? q.options[a.originalIndex]
          : null;
        const scoredItem = scored.find(s => s.id === q.id);
        const group = getGroup(q.group);
        return {
          questionId: q.id,
          groupId: q.group,
          groupName: group?.name || q.group,
          topic: q.topic,
          selectedLevel: a?.isNA ? null : (a?.level ?? null),
          selectedOptionText: selectedOption?.text || null,
          notApplicable: a?.isNA === true,
          rawScore: scoredItem?.rawScore ?? 0,
          weight: scoredItem?.weight ?? getQuestionWeight(q),
          weightedScore: scoredItem?.points ?? 0,
          maxScore: scoredItem?.maxPoints ?? 0,
          possibleMaxScore: scoredItem?.possibleMax ?? getMaxRawScore(q) * getQuestionWeight(q),
          comment: a?.comment || '',
        };
      }),
      scoring: {
        total,
        maxScore,
        percent: Number(percent.toFixed(1)),
        applicableQuestions: applicableCount,
        totalQuestions,
        tier: tier.name,
        tierRecommendation: tier.recommendation,
        groupSummaries,
      },
      openResponses: collectOpenResponses(answers),
      warnings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-maturity-${sessionId}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="pt-10 sm:pt-16">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-3 flex items-center gap-2">
        <Sparkle size={12} stroke={2} />
        <span>Kết quả · {new Date().toLocaleDateString('vi-VN')}</span>
      </div>

      <h1 className="font-display font-medium text-[34px] sm:text-[44px] leading-[1.05] tracking-tight text-balance mb-2">
        Profile: <span className="text-accent">{tier.name}</span>
      </h1>
      <p className="text-[15px] text-ink/80 leading-relaxed max-w-xl">
        {tier.recommendation}
      </p>

      {endpointEnabled && (
        <SubmissionBanner state={submitState} error={submitError} onRetry={onRetry} sessionId={sessionId} />
      )}

      {/* Score block */}
      <div className="mt-10 grid grid-cols-2 gap-6 sm:gap-8 border-t border-b border-line/60 py-8">
        <ScoreStat label="Tổng điểm" value={formatScore(total)} suffix={`/ ${formatScore(maxScore)}`} />
        <ScoreStat label="Tỷ lệ" value={percent.toFixed(0)} suffix="/ 100%" />
      </div>
      <p className="mt-3 text-[12px] text-muted leading-relaxed">
        Điểm tối đa được tính trên {applicableCount}/{totalQuestions} câu áp dụng; câu N/A không bị phạt và không cộng vào mẫu điểm.
      </p>

      {/* Radar */}
      <section className="mt-12">
        <SectionTitle eyebrow={`Profile ${groupSummaries.length} nhóm`} title="Bản đồ radar" />
        <div className="mt-6 -mx-3 sm:-mx-6">
          <RadarBlock data={radarData} dark={dark} />
        </div>
      </section>

      {/* Warnings — creator-only (preview mode). In DEPLOY=true these are hidden
          from participants but still included in the email payload sent to the creator. */}
      {!deploy && warnings.length > 0 && (
        <section className="mt-14">
          <div className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-warn border border-warn/40 rounded-sm px-2 py-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn"></span>
            Preview mode · chỉ người tạo thấy
          </div>
          <SectionTitle eyebrow={`${warnings.length} tín hiệu phát hiện`} title="Đáng xem lại" />
          <p className="mt-4 text-[14px] text-ink/75 leading-relaxed max-w-2xl">
            Hệ thống đối chiếu chéo các câu trả lời để tìm mẫu <em>"false high"</em> — những chỗ respondent tự đánh giá cao ở một chiều nhưng các chiều bổ trợ lại thấp, hoặc bối cảnh team/dự án chưa đủ để đạt mức đó. Khi <code className="font-mono text-[12px]">DEPLOY=true</code>, section này được ẩn khỏi người tham gia; warnings vẫn được gửi đầy đủ trong email gửi về bạn.
          </p>
          <ul className="mt-6 space-y-3">
            {warnings.map(w => (
              <li key={w.key} className="border border-line rounded-sm p-4 sm:p-5 bg-line/20">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5 text-warn"><AlertTri size={18} /></div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="font-display font-medium text-[15px] leading-tight">{w.title}</h3>
                      <div className="flex gap-1">
                        {w.refs.map(r => (
                          <span key={r} className="font-mono text-[10px] px-1.5 py-0.5 bg-paper border border-line rounded-sm text-muted">Q{r}</span>
                        ))}
                      </div>
                    </div>
                    <p className="text-[13.5px] leading-relaxed text-ink/80">{w.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] text-muted leading-relaxed">
            Đây là tín hiệu nội bộ cho người phân tích — không phải kết luận. Dùng để đánh giá độ tin cậy của self-rating; nên đối chiếu với các phản hồi mở/phỏng vấn trước khi ra quyết định.
          </p>
        </section>
      )}

      {/* Per-topic breakdown — creator-only (preview mode). Participants chỉ thấy radar. */}
      {!deploy && (
        <section className="mt-14">
          <div className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-warn border border-warn/40 rounded-sm px-2 py-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn"></span>
            Preview mode · chỉ người tạo thấy
          </div>
          <SectionTitle eyebrow={`${DATA.questions.length} câu · weighted scoring`} title="Chi tiết từng câu" />
          <ol className="mt-6 space-y-3">
            {scored.map((s, idx) => {
              const q = DATA.questions[idx];
              const group = getGroup(q.group);
              return (
                <li key={s.id} className="border border-line rounded-sm">
                  <div className="px-4 sm:px-5 py-4 flex items-start gap-4">
                    <div className="font-mono text-[11px] text-muted pt-0.5 w-6 shrink-0 tabular-nums">{String(s.id).padStart(2, '0')}</div>
                    <div className="flex-1 min-w-0">
                      {group && (
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted mb-1.5">
                          {group.name}
                        </div>
                      )}
                      <div className="font-display font-medium text-[15px] leading-snug">{q.topic}</div>
                      <div className="mt-2 flex items-center gap-3">
                        <LevelDots score={s.level || 0} />
                        <div className="font-mono text-[11px] text-muted">
                          {s.isNA
                            ? `N/A · excluded · w${s.weight}`
                            : `L${s.level} · ${formatScore(s.points)}/${formatScore(s.maxPoints)} điểm · w${s.weight}`}
                        </div>
                      </div>
                      {s.comment && (
                        <p className="mt-3 text-[12.5px] leading-relaxed text-ink/75 border-l-2 border-line pl-3">
                          <span className="font-mono uppercase tracking-wider text-[10px] text-muted mr-1.5">Bối cảnh →</span>
                          {s.comment}
                        </p>
                      )}
                      <p className="mt-3 text-[12.5px] leading-relaxed text-ink/70">
                        <span className="font-mono uppercase tracking-wider text-[10px] text-muted mr-1.5">Lưu ý phổ biến →</span>
                        {q.note}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Actions */}
      <div className="mt-14 flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleDownload}
          className="flex-1 inline-flex items-center justify-between gap-2 px-5 py-4 bg-ink text-paper rounded-sm hover:bg-ink/90 transition-colors"
        >
          <span className="font-medium text-sm">Tải kết quả về (.json)</span>
          <Download size={16} />
        </button>
        <button
          onClick={onRestart}
          className="inline-flex items-center justify-center gap-2 px-5 py-4 border border-line text-ink rounded-sm hover:border-ink/40 hover:bg-line/30 transition-colors"
        >
          <RotateCcw size={16} />
          <span className="font-medium text-sm">Bắt đầu lại</span>
        </button>
      </div>

      <p className="mt-8 text-[12px] text-muted leading-relaxed">
        {endpointEnabled
          ? <>Kết quả đã được gửi về email người quản lý khảo sát (nếu mạng cho phép) và lưu cục bộ trên thiết bị của bạn.</>
          : <>Phản hồi đã được ghi ẩn danh vào bộ nhớ cục bộ của trình duyệt.</>
        } Session ID: <span className="font-mono">{sessionId}</span>.
      </p>
    </div>
  );
}

function SubmissionBanner({ state, error, onRetry, sessionId }) {
  if (state === 'idle' || state === 'skipped') return null;
  const isSending = state === 'sending';
  const isSent = state === 'sent';
  const isError = state === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-6 border rounded-sm px-4 py-3 flex items-start gap-3
        ${isSent ? 'border-accent/30 bg-accent-soft'
        : isError ? 'border-warn/40 bg-warn/5'
        : 'border-line bg-line/30'}`}
    >
      <div className={`shrink-0 mt-0.5 ${isSent ? 'text-accent' : isError ? 'text-warn' : 'text-muted'}`}>
        {isSending && <SaveIcon size={16} />}
        {isSent && <Check size={16} stroke={2} />}
        {isError && <AlertTri size={16} />}
      </div>
      <div className="flex-1 min-w-0 text-[13px] leading-relaxed">
        {isSending && (
          <span className="text-ink/80">Đang gửi kết quả về email người quản lý khảo sát…</span>
        )}
        {isSent && (
          <span className="text-ink/85">
            Đã gửi kết quả thành công. <span className="font-mono text-[11px] text-muted">ID: {sessionId.slice(0, 16)}</span>
          </span>
        )}
        {isError && (
          <div>
            <div className="text-ink/85 mb-1.5">
              Không gửi được kết quả qua mạng — dữ liệu vẫn được lưu cục bộ và bạn có thể tải về dưới đây.
            </div>
            {error && (
              <div className="font-mono text-[10.5px] text-muted break-all mb-2">{error}</div>
            )}
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 text-[12px] text-ink underline underline-offset-4 hover:no-underline"
            >
              <RotateCcw size={12} /> Thử gửi lại
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreStat({ label, value, suffix }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted mb-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="font-display font-medium text-[40px] sm:text-[52px] leading-none tracking-tight tabular-nums">{value}</div>
        <div className="font-mono text-[13px] text-muted tabular-nums">{suffix}</div>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-2">{eyebrow}</div>
      <h2 className="font-display font-medium text-[22px] sm:text-[26px] leading-tight tracking-tight">{title}</h2>
    </div>
  );
}

function LevelDots({ score }) {
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={`w-2 h-2 rounded-full ${i <= score ? 'bg-ink' : 'bg-line'}`} />
      ))}
    </div>
  );
}

function RadarBlock({ data, dark }) {
  // Mobile responsive height
  const [height, setHeight] = useState(380);
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setHeight(w < 640 ? 340 : w < 768 ? 400 : 460);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Reactive to theme — use prop, not one-shot DOM read.
  // Dark labels need significantly more brightness than the body ink color
  // (`#e8e5dd`) to read crisply against the dark paper background.
  const inkColor   = dark ? '#f5f0e6' : '#1c2230';
  const lineColor  = dark ? '#4a4f5a' : '#dfd9cd';
  const accentColor = dark ? '#9fcfd4' : '#3a6f76';

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%" margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <PolarGrid stroke={lineColor} />
          <PolarAngleAxis
            dataKey="topic"
            tick={{ fill: inkColor, fontSize: 10.5, fontFamily: 'IBM Plex Mono, ui-monospace, monospace' }}
            tickLine={false}
          />
          <PolarRadiusAxis
            domain={[0, 5]}
            tickCount={6}
            angle={90}
            tick={{ fill: lineColor, fontSize: 9 }}
            stroke={lineColor}
            axisLine={false}
          />
          <Radar
            name="Maturity"
            dataKey="score"
            stroke={accentColor}
            fill={accentColor}
            fillOpacity={0.18}
            strokeWidth={1.5}
            dot={{ r: 3, fill: accentColor, strokeWidth: 0 }}
            isAnimationActive={true}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================ mount ================================ */
window.Survey = Survey;
