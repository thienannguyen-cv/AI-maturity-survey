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
const FORMSPREE_FORM_ID = 'mwvzqdvj'; // e.g. 'mqejaady'  ← paste form ID here
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
const COMMUNITY_DASHBOARD_URL = 'https://ai-maturity-dashboard-implementatio.vercel.app/dashboard';

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
function getGroup(groupId, lang = 'vi') {
  return localizeGroup((DATA.groups || []).find(g => g.id === groupId) || null, lang);
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

const UI_TEXT = {
  vi: {
    languageToggle: 'EN',
    languageAria: 'Đổi ngôn ngữ',
    lightMode: 'Chế độ sáng',
    darkMode: 'Chế độ tối',
    loading: 'đang tải…',
    internalAnon: 'Đánh giá nội bộ · ẩn danh',
    heroLine1: 'Mức độ tích hợp AI',
    heroLine2: 'trong dự án phần mềm.',
    welcomeCopy: 'Bài đánh giá gồm {questionCount} câu maturity giúp bạn định vị dự án trên thang trưởng thành 5 mức (CMMI điều chỉnh cho AI-assisted development). Bạn sẽ nhận được điểm tổng theo trọng số, profile radar {groupCount} nhóm tương tác được, và khuyến nghị cụ thể cho bước tiếp theo.',
    time: 'Thời gian',
    questions: 'Câu hỏi',
    storage: 'Lưu trữ',
    anonymous: 'Ẩn danh',
    resultNoteTitle: 'Lưu ý về kết quả',
    savedSession: 'Đã lưu phiên trước',
    resumeAt: 'Bạn đang ở',
    continue: 'Tiếp tục',
    restartFromBeginning: 'Bắt đầu lại từ đầu',
    startAssessment: 'Bắt đầu đánh giá',
    privacyWithEndpoint: 'Phản hồi được lưu cục bộ trên trình duyệt và (khi nộp) gửi về email người quản lý khảo sát kèm một mã session tự sinh để phân biệt phiên trả lời. Bài khảo sát không yêu cầu tên, email, tên công ty, tên dự án hoặc thông tin định danh. Khi gửi khảo sát, phản hồi của bạn có thể được lưu trữ và phân tích để tạo kết quả cá nhân, cải thiện survey và xây dựng thống kê tổng hợp cho dashboard cộng đồng. Phản hồi thô và góp ý tự do sẽ không được công khai nguyên văn. Bạn có thể tạm dừng giữa chừng — tiến độ sẽ được khôi phục khi quay lại.',
    privacyLocalOnly: 'Phản hồi của bạn được lưu cục bộ trên trình duyệt và (khi nộp) ghi ẩn danh vào kho dữ liệu tổng hợp. Bài khảo sát không yêu cầu tên, email, tên công ty, tên dự án hoặc thông tin định danh. Khi gửi khảo sát, phản hồi của bạn có thể được lưu trữ và phân tích để tạo kết quả cá nhân, cải thiện survey và xây dựng thống kê tổng hợp cho dashboard cộng đồng. Phản hồi thô và góp ý tự do sẽ không được công khai nguyên văn. Bạn có thể tạm dừng giữa chừng — tiến độ sẽ được khôi phục khi quay lại.',
    sourceNoteLabel: 'Minh bạch triển khai',
    sourcePublicNote: 'Mã nguồn công khai tại: https://github.com/thienannguyen-cv/AI-maturity-survey. Trang khảo sát được cập nhật tự động nhờ liên kết triển khai giữa Vercel và kho mã nguồn.',
    contextPart: 'Phần A · Bối cảnh',
    unscored: 'không tính điểm',
    startEvaluation: 'Bắt đầu phần đánh giá',
    next: 'Tiếp theo',
    back: 'Quay lại',
    question: 'Câu',
    commonInfo: 'Thông tin chung',
    close: 'Đóng',
    optionalContext: 'Bổ sung bối cảnh (tuỳ chọn)',
    contextPlaceholder: 'Thêm bối cảnh nếu cần.',
    finishAndSeeResults: 'Hoàn thành & xem kết quả',
    goToFeedback: 'Tiếp đến góp ý',
    feedbackOptional: 'Phần này không bắt buộc và không ảnh hưởng đến điểm maturity.',
    results: 'Kết quả',
    profile: 'Profile',
    totalScore: 'Tổng điểm',
    percent: 'Tỷ lệ',
    maxScoreNote: 'Điểm tối đa được tính trên {applicableCount}/{totalQuestions} câu áp dụng; câu N/A không bị phạt và không cộng vào mẫu điểm.',
    scoringTitle: 'Cách tính điểm',
    radarEyebrow: 'Profile {count} nhóm · tương tác',
    radarTitle: 'Bản đồ radar',
    preview: 'Preview',
    reviewSignals: 'Đáng xem lại',
    signalsFound: '{count} tín hiệu phát hiện',
    falseHighCopy: 'Hệ thống đối chiếu chéo các câu trả lời để tìm mẫu "false high" — những chỗ respondent tự đánh giá cao ở một chiều nhưng các chiều bổ trợ lại thấp, hoặc bối cảnh team/dự án chưa đủ để đạt mức đó.',
    internalSignalCopy: 'Đây là tín hiệu nội bộ cho người phân tích — không phải kết luận. Dùng để đánh giá độ tin cậy của self-rating; nên đối chiếu với các phản hồi mở/phỏng vấn trước khi ra quyết định.',
    detailEyebrow: '{count} câu · weighted scoring',
    detailTitle: 'Chi tiết từng câu',
    detailInstruction: 'Sắp xếp theo {groupCount} nhóm. Bấm tên nhóm trên radar để cuộn xuống nhóm tương ứng — nhóm được chọn sẽ được làm nổi bật ở đây.',
    group: 'Nhóm',
    points: 'điểm',
    ask: 'Hỏi →',
    selected: 'Đã chọn →',
    context: 'Bối cảnh →',
    note: 'Lưu ý →',
    downloadJson: 'Tải kết quả về (.json)',
    restart: 'Bắt đầu lại',
    sentFooter: 'Kết quả đã được gửi về email người quản lý khảo sát (nếu mạng cho phép) và lưu cục bộ trên thiết bị của bạn.',
    localFooter: 'Phản hồi đã được ghi ẩn danh vào bộ nhớ cục bộ của trình duyệt.',
    sending: 'Đang gửi kết quả về email người quản lý khảo sát…',
    sent: 'Đã gửi kết quả thành công.',
    sendError: 'Không gửi được kết quả qua mạng — dữ liệu vẫn được lưu cục bộ và bạn có thể tải về dưới đây.',
    retrySend: 'Thử gửi lại',
    savedProgress: 'Đã lưu tiến độ',
    feedbackResume: 'Phần góp ý cải thiện',
    warnEstimateCostTitle: 'Ước lượng cao nhưng cost observability thấp',
    warnEstimateCostDetail: 'Bạn tự đánh giá ước lượng đã trưởng thành (Câu 1) nhưng chưa track cost/token (Câu 11). Khả năng cao estimate đang dựa trực giác chứ không phải dữ liệu — đáng xem lại Câu 1.',
    warnEstimateReadinessTitle: 'Estimate cao nhưng planning readiness thấp',
    warnEstimateReadinessDetail: 'Ước lượng AI trưởng thành cần task slicing và definition of ready đủ rõ. Nếu Q14/Q15 thấp, estimate Phase 1 có thể vẫn đang dựa vào kỳ vọng hơn là điều kiện thực thi.',
    warnTaskReadinessTitle: 'Task slicing tốt nhưng readiness chưa đủ',
    warnTaskReadinessDetail: 'Backlog được chia cho AI khá tốt, nhưng trước khi agent chạy lại thiếu acceptance criteria/context/test command. Đây là nguồn rework phổ biến.',
    warnDefectEvalTitle: 'Phát hiện lỗi tốt nhưng chưa có eval framework',
    warnDefectEvalDetail: 'Bạn xếp Câu 3 cao nhưng Câu 10 thấp. Phát hiện silent failure không có eval baseline thường là anecdote — đáng xem lại Câu 3.',
    warnHarnessSecurityTitle: 'Harness cao nhưng runtime security thấp',
    warnHarnessSecurityDetail: 'Harness trưởng thành mà sandbox/permission còn yếu là rủi ro vận hành lớn. Nên xem lại quyền tool, secret và audit trail trước khi mở rộng agent.',
    warnModelEvalTitle: 'Model selection cao nhưng eval thấp',
    warnModelEvalDetail: 'Chọn model theo task mà chưa có eval baseline dễ trở thành cảm tính nâng cao. Nên có bộ task nội bộ trước khi tin vào routing/model policy.',
    warnSkillContextTitle: 'Catalog skill enterprise cần thời gian tích lũy',
    warnSkillContextDetail: 'Bạn xếp Câu 5 ở mức cao nhưng team nhỏ và dự án mới <3 tháng. L4–L5 thường đòi hỏi accumulation lâu hơn — đáng xem lại Câu 5.',
    warnParallelSwarmTitle: 'Parallel swarm thường là anti-pattern',
    warnParallelSwarmDetail: 'Câu 12 phương án bạn chọn (parallel swarm nhiều agent cùng ghi) thường tệ hơn single-agent về mặt chất lượng kiến trúc. Đây không phải bước tiến, mà là vùng cần nghiên cứu thêm.',
    warnManyNaTitle: 'Nhiều câu chưa áp dụng',
    warnManyNaDetail: 'Có {naCount} câu được đánh dấu N/A nên điểm tối đa áp dụng đã giảm. Kết quả vẫn hợp lệ, nhưng nên đọc như snapshot phạm vi hiện tại chứ không phải maturity toàn diện.',
    selectedLevel: 'L{level} đã chọn →',
    currentlyViewing: 'Đang xem',
    applicableQuestions: '{applicableCount}/{questionCount} câu áp dụng',
    backToOverview: 'Quay lại tổng quan',
    feedbackSafetyTitle: 'Lưu ý',
    feedbackSafetyNote: 'Chúng tôi không yêu cầu và không khuyến khích bạn cung cấp thông tin định danh hoặc thông tin nhạy cảm như tên cá nhân, email, tên công ty, tên khách hàng, tên dự án cụ thể, credential, dữ liệu khách hàng, bí mật nội bộ hoặc nội dung bạn không có quyền chia sẻ. Phản hồi thô sẽ không được công khai nguyên văn; dashboard chỉ sử dụng dữ liệu ở dạng tổng hợp.',
    radarHint: 'Bấm vào tên nhóm để xem chi tiết · {groupCount} nhóm · {dimensionCount} chiều đo',
    radarExitDetail: 'thoát khỏi chế độ chi tiết',
    radarBackOverview: 'quay lại tổng quan',
    radarViewGroup: 'xem chi tiết nhóm',
  },
  en: {
    languageToggle: 'VI',
    languageAria: 'Switch language',
    lightMode: 'Light mode',
    darkMode: 'Dark mode',
    loading: 'loading…',
    internalAnon: 'Internal assessment · anonymous',
    heroLine1: 'AI integration maturity',
    heroLine2: 'in software projects.',
    welcomeCopy: 'This assessment includes {questionCount} maturity questions to help position your project on a 5-level maturity scale (CMMI adapted for AI-assisted development). You will receive a weighted score, an interactive {groupCount}-group radar profile, and practical next-step guidance.',
    time: 'Time',
    questions: 'Questions',
    storage: 'Storage',
    anonymous: 'Anonymous',
    resultNoteTitle: 'How to read the result',
    savedSession: 'Saved session',
    resumeAt: 'You are at',
    continue: 'Continue',
    restartFromBeginning: 'Start over',
    startAssessment: 'Start assessment',
    privacyWithEndpoint: 'Responses are stored locally in this browser and, on submission, sent to the survey manager email with a generated session ID to distinguish response sessions. The survey does not ask for your name, email address, company name, project name, or identifying information. When you submit the survey, your responses may be stored and analyzed to generate your individual result, improve the survey, and produce aggregate statistics for the community dashboard. Raw responses and free-text feedback will not be published verbatim. You can pause midway — progress will be restored when you return.',
    privacyLocalOnly: 'Your responses are stored locally in this browser and, on submission, anonymously written to aggregate storage. The survey does not ask for your name, email address, company name, project name, or identifying information. When you submit the survey, your responses may be stored and analyzed to generate your individual result, improve the survey, and produce aggregate statistics for the community dashboard. Raw responses and free-text feedback will not be published verbatim. You can pause midway — progress will be restored when you return.',
    sourceNoteLabel: 'Deployment transparency',
    sourcePublicNote: 'Source code is public at: https://github.com/thienannguyen-cv/AI-maturity-survey. This survey page is updated automatically via deployment linkage between Vercel and the source repository.',
    contextPart: 'Part A · Context',
    unscored: 'not scored',
    startEvaluation: 'Start assessment',
    next: 'Next',
    back: 'Back',
    question: 'Question',
    commonInfo: 'General context',
    close: 'Close',
    optionalContext: 'Additional context (optional)',
    contextPlaceholder: 'Add context if useful.',
    finishAndSeeResults: 'Finish & view results',
    goToFeedback: 'Continue to feedback',
    feedbackOptional: 'This section is optional and does not affect the maturity score.',
    results: 'Results',
    profile: 'Profile',
    totalScore: 'Total score',
    percent: 'Percent',
    maxScoreNote: 'The maximum score is based on {applicableCount}/{totalQuestions} applicable questions; N/A is not penalized and is excluded from the score denominator.',
    scoringTitle: 'Scoring method',
    radarEyebrow: '{count}-group profile · interactive',
    radarTitle: 'Radar map',
    preview: 'Preview',
    reviewSignals: 'Worth reviewing',
    signalsFound: '{count} signals detected',
    falseHighCopy: 'The system cross-checks answers for "false high" patterns — cases where a respondent rates one dimension high while supporting dimensions or project context do not appear mature enough.',
    internalSignalCopy: 'These are internal signals for analysis, not conclusions. Use them to assess self-rating reliability and compare with open responses or interviews before making decisions.',
    detailEyebrow: '{count} questions · weighted scoring',
    detailTitle: 'Question details',
    detailInstruction: 'Grouped into {groupCount} categories. Click a group name on the radar to scroll to the corresponding section — the selected group will be highlighted here.',
    group: 'Group',
    points: 'points',
    ask: 'Question →',
    selected: 'Selected →',
    context: 'Context →',
    note: 'Note →',
    downloadJson: 'Download results (.json)',
    restart: 'Start over',
    sentFooter: 'Results have been sent to the survey manager email when network access allows, and stored locally on this device.',
    localFooter: 'The response has been anonymously stored in this browser local storage.',
    sending: 'Sending results to the survey manager email…',
    sent: 'Results sent successfully.',
    sendError: 'Could not send results over the network — the data is still stored locally and can be downloaded below.',
    retrySend: 'Retry sending',
    savedProgress: 'Progress saved',
    feedbackResume: 'Improvement feedback',
    warnEstimateCostTitle: 'High estimating maturity but low cost observability',
    warnEstimateCostDetail: 'You rated AI estimation as mature (Question 1), but cost/token tracking is still low (Question 11). The estimate may rely more on intuition than data — review Question 1.',
    warnEstimateReadinessTitle: 'High estimates but low planning readiness',
    warnEstimateReadinessDetail: 'Mature AI estimation needs clear task slicing and definition of ready. If Q14/Q15 are low, Phase 1 estimates may still reflect expectations more than execution conditions.',
    warnTaskReadinessTitle: 'Good task slicing but weak readiness',
    warnTaskReadinessDetail: 'The backlog appears well sliced for AI, but the agent may still start without acceptance criteria, context, or test commands. This is a common source of rework.',
    warnDefectEvalTitle: 'Strong defect handling but no eval framework',
    warnDefectEvalDetail: 'Question 3 is rated high while Question 10 is low. Detecting silent failures without an eval baseline is often anecdotal — review Question 3.',
    warnHarnessSecurityTitle: 'Advanced harness but weak runtime security',
    warnHarnessSecurityDetail: 'A mature harness with weak sandboxing/permissions creates major operational risk. Review tool permissions, secrets, and audit trails before scaling agent usage.',
    warnModelEvalTitle: 'High model selection maturity but low eval maturity',
    warnModelEvalDetail: 'Choosing models by task without an eval baseline can become sophisticated guesswork. Build an internal task set before trusting routing or model policy.',
    warnSkillContextTitle: 'Enterprise skill catalogs need time to accumulate',
    warnSkillContextDetail: 'Question 5 is rated high, but the team is small and the project is newer than 3 months. L4-L5 usually requires longer accumulation — review Question 5.',
    warnParallelSwarmTitle: 'Parallel swarm is often an anti-pattern',
    warnParallelSwarmDetail: 'The selected Question 12 option (many agents writing in parallel) is often worse than single-agent work for architectural quality. Treat it as an area to study, not a maturity step.',
    warnManyNaTitle: 'Many questions marked not applicable',
    warnManyNaDetail: '{naCount} questions were marked N/A, so the applicable maximum score is lower. The result is still valid, but read it as a snapshot of the current scope rather than comprehensive maturity.',
    selectedLevel: 'L{level} selected →',
    currentlyViewing: 'Viewing',
    applicableQuestions: '{applicableCount}/{questionCount} applicable questions',
    feedbackSafetyTitle: 'Note',
    feedbackSafetyNote: 'We do not ask for or encourage you to provide identifying or sensitive information such as personal names, email addresses, company names, client names, specific project names, credentials, customer data, internal secrets, or anything you are not authorized to share. Raw feedback will not be published verbatim; the dashboard only uses data in aggregate form.',
    backToOverview: 'Back to overview',
    radarHint: 'Click a group name to view details · {groupCount} groups · {dimensionCount} dimensions',
    radarExitDetail: 'exit detail mode',
    radarBackOverview: 'return to overview',
    radarViewGroup: 'view group details',
  },
};

function ui(lang, key, params = {}) {
  let text = UI_TEXT[lang]?.[key] || UI_TEXT.vi[key] || key;
  Object.entries(params).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value));
  });
  return text;
}
function getPath(obj, path) {
  return path.reduce((cur, key) => (cur && cur[key] != null ? cur[key] : undefined), obj);
}
function tx(lang, path, fallback) {
  if (lang === 'vi') return fallback;
  return getPath(DATA.translations?.[lang], path) ?? fallback;
}
function localizeSurvey(lang, key) {
  return tx(lang, ['survey', key], DATA.survey?.[key]);
}
function localizeMethodology(lang) {
  const base = DATA.survey?.methodology || {};
  const t = getPath(DATA.translations?.[lang], ['survey', 'methodology']) || {};
  return {
    ...base,
    label: t.label || base.label,
    title: t.title || base.title,
    url: t.url || base.url,
  };
}
function localizeScoringNote(lang) {
  return tx(lang, ['scoring', 'note'], DATA.scoring?.note);
}
function localizeNA(lang) {
  return tx(lang, ['scoring', 'not_applicable', 'label'], DATA.scoring?.not_applicable?.label);
}
function localizeWeightGuidance(item, lang) {
  const t = getPath(DATA.translations?.[lang], ['scoring', 'weight_guidance', String(item.weight)]) || {};
  return { ...item, label: t.label || item.label, description: t.description || item.description };
}
function localizeOpenResponse(lang) {
  const t = getPath(DATA.translations?.[lang], ['open_response']) || {};
  return {
    ...(DATA.open_response || {}),
    label: t.label || DATA.open_response?.label,
    placeholder: t.placeholder || DATA.open_response?.placeholder,
  };
}
function localizeFeedback(lang) {
  const t = getPath(DATA.translations?.[lang], ['survey_feedback']) || {};
  return {
    ...(DATA.survey_feedback || {}),
    title: t.title || DATA.survey_feedback?.title,
    eyebrow: t.eyebrow || DATA.survey_feedback?.eyebrow,
    description: t.description || DATA.survey_feedback?.description,
    placeholder: t.placeholder || DATA.survey_feedback?.placeholder,
  };
}
function localizeDemographic(spec, lang) {
  const t = getPath(DATA.translations?.[lang], ['demographics', spec.id]) || {};
  return { ...spec, label: t.label || spec.label, displayOptions: t.options || spec.options };
}
function localizeGroup(group, lang) {
  if (!group) return group;
  const t = getPath(DATA.translations?.[lang], ['groups', group.id]) || {};
  return { ...group, name: t.name || group.name, short: t.short || group.short, description: t.description || group.description };
}
function localizeTier(tier, lang) {
  if (!tier) return tier;
  const t = getPath(DATA.translations?.[lang], ['tiers', tier.name]) || {};
  return { ...tier, name: t.name || tier.name, recommendation: t.recommendation || tier.recommendation };
}
function localizeQuestion(question, lang) {
  if (!question) return question;
  const t = getPath(DATA.translations?.[lang], ['questions', String(question.id)]) || {};
  return {
    ...question,
    topic: t.topic || question.topic,
    short: t.short || question.short,
    text: t.text || question.text,
    measure: t.measure || question.measure,
    note: t.note || question.note,
    options: question.options.map((opt, i) => ({ ...opt, text: t.options?.[i] || opt.text })),
  };
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
  const [stage, setStage] = useState('welcome'); // welcome | demo | question | feedback | result
  const [demoIndex, setDemoIndex] = useState(0); // 0..1
  const [qIndex, setQIndex] = useState(0);
  const [demographics, setDemographics] = useState({});
  const [answers, setAnswers] = useState({});     // {qId: {level, score, originalIndex, isNA, comment}}
  const [surveyFeedback, setSurveyFeedback] = useState('');
  const [lang, setLang] = useState('vi');
  const [dark, setDark] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [resumeTargetStage, setResumeTargetStage] = useState(null);
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
      const langSaved = await storage.get('ai-maturity:language');
      if (langSaved === 'en' || langSaved === 'vi') {
        setLang(langSaved);
      }
      if (themeSaved === 'dark' || (!themeSaved && window.matchMedia?.('(prefers-color-scheme: dark)').matches)) {
        setDark(true);
      }
      if (saved && saved.sessionId && saved.stage && saved.stage !== 'result') {
        // Offer resume
        setSessionId(saved.sessionId);
        setDemographics(saved.demographics || {});
        setAnswers(saved.answers || {});
        setSurveyFeedback(saved.surveyFeedback || '');
        setStage('welcome');
        setDemoIndex(saved.demoIndex || 0);
        setQIndex(saved.qIndex || 0);
        setResumeTargetStage(saved.stage || null);
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

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = localizeSurvey(lang, 'title') || 'AI Maturity Survey';
    if (booted) storage.set('ai-maturity:language', lang);
  }, [lang, booted]);

  // persist
  const persist = useCallback(async (overrides = {}) => {
    if (!sessionId) return;
    const snapshot = {
      sessionId, stage, demoIndex, qIndex, demographics, answers, surveyFeedback,
      ...overrides,
      updatedAt: new Date().toISOString(),
    };
    await storage.set(SESSION_KEY, snapshot);
    // flash
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedFlash(true);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 1400);
  }, [sessionId, stage, demoIndex, qIndex, demographics, answers, surveyFeedback]);

  /* ---------- handlers ---------- */
  const startFresh = async () => {
    const sid = makeSessionId();
    setSessionId(sid);
    setDemographics({});
    setAnswers({});
    setSurveyFeedback('');
    setDemoIndex(0);
    setQIndex(0);
    setShowResume(false);
    setResumeTargetStage(null);
    setStage('demo');
    setSlideDir(1);
    await storage.set(SESSION_KEY, { sessionId: sid, stage: 'demo', demoIndex: 0, qIndex: 0, demographics: {}, answers: {}, surveyFeedback: '', updatedAt: new Date().toISOString() });
  };
  const resume = () => {
    setShowResume(false);
    if (resumeTargetStage === 'feedback') setStage('feedback');
    else if (qIndex > 0 || Object.keys(answers).length > 0) setStage('question');
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
  const setFeedbackAnswer = (value) => {
    setSurveyFeedback(value);
    persist({ surveyFeedback: value });
  };

  const goNext = () => {
    setSlideDir(1);
    const feedbackEnabled = DATA.survey_feedback?.enabled !== false;
    if (stage === 'demo') {
      if (demoIndex < DATA.demographics.length - 1) { setDemoIndex(demoIndex + 1); persist({ demoIndex: demoIndex + 1 }); }
      else { setStage('question'); setQIndex(0); persist({ stage: 'question', qIndex: 0 }); }
    } else if (stage === 'question') {
      if (qIndex < DATA.questions.length - 1) { setQIndex(qIndex + 1); persist({ qIndex: qIndex + 1 }); }
      else if (feedbackEnabled) { setStage('feedback'); persist({ stage: 'feedback' }); }
      else { submit(); }
    } else if (stage === 'feedback') {
      submit();
    }
  };
  const goBack = () => {
    setSlideDir(-1);
    if (stage === 'feedback') {
      setStage('question');
      setQIndex(DATA.questions.length - 1);
      persist({ stage: 'question', qIndex: DATA.questions.length - 1 });
    } else if (stage === 'question') {
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
      const noAnswer = submission.language === 'en' ? '(no answer)' : '(không trả lời)';
      const body = {
        participant_id: submission.sessionId,
        language: submission.language || 'vi',
        submitted_at: submission.submittedAt,
        tier: summary.tier.name,
        total_score: formatScore(summary.total),
        max_score: formatScore(summary.maxScore),
        percent_score: summary.percent.toFixed(1),
        applicable_questions: `${summary.applicableCount}/${summary.totalQuestions}`,
        role: submission.demographics?.a1 || noAnswer,
        team_size: submission.demographics?.a2 || noAnswer,
        project_age: submission.demographics?.a3 || noAnswer,
        ai_scope: submission.demographics?.a4 || noAnswer,
        domain_risk: submission.demographics?.a5 || noAnswer,
        delivery_baseline: submission.demographics?.a6 || noAnswer,
        warnings_count: summary.warnings.length,
        warnings: summary.warnings.map(w => `${w.title} [${w.refs.map(r => 'Q' + r).join(', ')}]`).join(' · '),
        open_responses_count: submission.openResponses.length,
        open_responses: submission.openResponses.map(r => `Q${r.questionId}: ${r.comment}`).join('\n---\n'),
        survey_feedback: submission.surveyFeedback || '',
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
    const submission = buildSubmission(sessionId, demographics, answers, surveyFeedback, lang);
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
    const submission = buildSubmission(sessionId, demographics, answers, surveyFeedback, lang);
    sendToEndpoint(submission);
  }, [sessionId, demographics, answers, surveyFeedback, lang, sendToEndpoint]);

  const restart = async () => {
    await storage.remove(SESSION_KEY);
    const sid = makeSessionId();
    setSessionId(sid);
    setDemographics({});
    setAnswers({});
    setSurveyFeedback('');
    setDemoIndex(0);
    setQIndex(0);
    setShowResume(false);
    setResumeTargetStage(null);
    setSlideDir(1);
    setSubmitState('idle');
    setSubmitError(null);
    setStage('welcome');
  };

  /* ---------- derived ---------- */
  const feedbackEnabled = DATA.survey_feedback?.enabled !== false;
  const totalSteps = DATA.demographics.length + DATA.questions.length + (feedbackEnabled ? 1 : 0);
  const currentStep =
    stage === 'welcome' ? 0
    : stage === 'demo' ? demoIndex + 1
    : stage === 'question' ? DATA.demographics.length + qIndex + 1
    : stage === 'feedback' ? totalSteps
    : totalSteps;

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      if (stage === 'question' || stage === 'demo' || stage === 'feedback') {
        if (e.key === 'ArrowRight' || e.key === 'Enter') {
          const canAdvance = stage === 'demo'
            ? !!demographics[DATA.demographics[demoIndex].id]
            : stage === 'question'
              ? hasQuestionChoice(answers[DATA.questions[qIndex].id])
              : true;
          if (canAdvance) { e.preventDefault(); goNext(); }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault(); goBack();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, demoIndex, qIndex, demographics, answers, surveyFeedback]);

  if (!booted) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink/40">
        <div className="text-sm font-mono tracking-wide">{ui(lang, 'loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink antialiased">
      <Header dark={dark} lang={lang} onToggleLang={() => setLang(l => l === 'vi' ? 'en' : 'vi')} onToggleDark={() => setDark(d => !d)} />

      <main className="flex-1 w-full">
        {stage === 'welcome' && (
          <WelcomeScreen
            lang={lang}
            endpointEnabled={!!SUBMISSION_ENDPOINT}
            onStart={startFresh}
            onResume={showResume ? resume : null}
            resumePosition={
              stage === 'welcome' && showResume
                ? (resumeTargetStage === 'feedback'
                    ? ui(lang, 'feedbackResume')
                    : qIndex > 0 || Object.keys(answers).length > 0
                    ? `${ui(lang, 'question')} ${qIndex + 1} / ${DATA.questions.length}`
                    : `${ui(lang, 'contextPart')} ${demoIndex + 1}/${DATA.demographics.length}`)
                : null
            }
          />
        )}

        {(stage === 'demo' || stage === 'question' || stage === 'feedback') && (
          <ProgressBar current={currentStep} total={totalSteps} />
        )}

        <div className="w-full max-w-2xl mx-auto px-5 sm:px-8 pb-32">
          {/* welcome rendered above */}
          {stage === 'demo' && (
            <SlideTransition keyName={'demo-' + demoIndex} dir={slideDir}>
              <DemographicScreen
                lang={lang}
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
                lang={lang}
                sessionId={sessionId}
                index={qIndex}
                total={DATA.questions.length}
                question={DATA.questions[qIndex]}
                value={answers[DATA.questions[qIndex].id]}
                onChange={(payload) => setAnswer(DATA.questions[qIndex].id, payload)}
                onNext={goNext}
                onBack={goBack}
                isLast={qIndex === DATA.questions.length - 1}
                nextLabel={qIndex === DATA.questions.length - 1 && feedbackEnabled ? ui(lang, 'goToFeedback') : null}
              />
            </SlideTransition>
          )}

          {stage === 'feedback' && (
            <SlideTransition keyName="feedback" dir={slideDir}>
              <SurveyFeedbackScreen
                lang={lang}
                value={surveyFeedback}
                onChange={setFeedbackAnswer}
                onNext={goNext}
                onBack={goBack}
              />
            </SlideTransition>
          )}

          {stage === 'result' && (
            <ResultScreen
              demographics={demographics}
              answers={answers}
              surveyFeedback={surveyFeedback}
              lang={lang}
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

      <SavedToast visible={savedFlash} lang={lang} />
    </div>
  );
}

/* ------------------------- header ----------------------------------- */
function Header({ dark, lang, onToggleLang, onToggleDark }) {
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
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleLang}
            aria-label={ui(lang, 'languageAria')}
            className="h-9 px-3 grid place-items-center rounded-sm border border-line text-[11px] font-mono tracking-wider text-muted hover:text-ink hover:border-ink/40 transition-colors"
          >
            {ui(lang, 'languageToggle')}
          </button>
          <button
            onClick={onToggleDark}
            aria-label={dark ? ui(lang, 'lightMode') : ui(lang, 'darkMode')}
            className="w-9 h-9 grid place-items-center rounded-sm border border-line text-muted hover:text-ink hover:border-ink/40 transition-colors"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
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
function WelcomeScreen({ lang, onStart, onResume, resumePosition, endpointEnabled }) {
  const demoCount = DATA.demographics?.length || 0;
  const questionCount = DATA.questions?.length || 0;
  const groupCount = DATA.groups?.length || 0;
  const disclaimer = localizeSurvey(lang, 'disclaimer');
  const methodology = localizeMethodology(lang);
  const scoringNote = localizeScoringNote(lang);
  const weightGuidance = (DATA.scoring?.weight_guidance || []).map(item => localizeWeightGuidance(item, lang));
  return (
    <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-32">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-6">
        {ui(lang, 'internalAnon')}
      </div>

      <h1 className="font-display font-medium text-[34px] sm:text-[44px] leading-[1.05] tracking-tight text-balance">
        {ui(lang, 'heroLine1')}<br/>
        <span className="text-muted">{ui(lang, 'heroLine2')}</span>
      </h1>

      <p className="mt-8 text-[15px] sm:text-base leading-relaxed text-ink/80 max-w-xl">
        {ui(lang, 'welcomeCopy', { questionCount, groupCount })}
      </p>

      <dl className="mt-12 grid grid-cols-3 gap-4 sm:gap-8 border-t border-line/60 pt-8">
        <Stat label={ui(lang, 'time')} value="~15 min" />
        <Stat label={ui(lang, 'questions')} value={`${demoCount} + ${questionCount}`} />
        <Stat label={ui(lang, 'storage')} value={ui(lang, 'anonymous')} />
      </dl>

      {(disclaimer || methodology?.title || scoringNote) && (
        <section className="mt-8 border-l-2 border-line pl-4 py-1 max-w-xl">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
            {ui(lang, 'resultNoteTitle')}
          </div>
          {disclaimer && (
            <p className="text-[13px] leading-relaxed text-ink/75">
              {disclaimer}
            </p>
          )}
          {methodology?.title && (
            <p className="mt-3 text-[12px] leading-relaxed text-ink/75">
              <span className="font-medium text-ink/85">{methodology.label}: </span>
              {methodology.url ? (
                <a
                  href={methodology.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 decoration-line hover:text-accent transition-colors"
                >
                  {methodology.title}
                </a>
              ) : (
                <span>{methodology.title}</span>
              )}
            </p>
          )}
          {scoringNote && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted whitespace-pre-line">
              {scoringNote}
            </p>
          )}
          {weightGuidance.length > 0 && (
            <div className="mt-3 grid gap-2">
              {weightGuidance.map(item => (
                <div key={item.weight} className="flex items-start gap-2 text-[12px] leading-relaxed text-ink/75">
                  <span className="mt-0.5 font-mono text-[10px] px-1.5 py-0.5 border border-line rounded-sm text-muted whitespace-nowrap">w{item.weight}</span>
                  <span><span className="font-medium text-ink/85">{item.label}:</span> {item.description}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="mt-12 space-y-4">
        {onResume && (
          <div className="border border-accent/30 bg-accent-soft px-4 py-4 rounded-sm flex items-center justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-accent mb-1">{ui(lang, 'savedSession')}</div>
              <div className="text-sm">{ui(lang, 'resumeAt')} <strong className="font-medium">{resumePosition}</strong></div>
            </div>
            <button
              onClick={onResume}
              className="shrink-0 px-4 py-2 bg-ink text-paper text-sm font-medium rounded-sm hover:bg-ink/90 transition-colors"
            >
              {ui(lang, 'continue')}
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onStart}
            className="group flex-1 inline-flex items-center justify-between px-5 py-4 bg-ink text-paper rounded-sm hover:bg-ink/90 transition-colors"
          >
            <span className="font-medium">{onResume ? ui(lang, 'restartFromBeginning') : ui(lang, 'startAssessment')}</span>
            <ChevronRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>

      <p className="mt-10 text-[12px] leading-relaxed text-muted max-w-xl">
        {(() => {
          const raw = endpointEnabled ? ui(lang, 'privacyWithEndpoint') : ui(lang, 'privacyLocalOnly');
          const marker = lang === 'vi' ? 'dashboard cộng đồng' : 'community dashboard';
          const idx = raw.indexOf(marker);
          if (idx === -1) return raw;
          const before = raw.slice(0, idx);
          const after = raw.slice(idx + marker.length);
          return (
            <>
              {before}
              <a
                href={COMMUNITY_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-ink/40 underline-offset-2 hover:text-ink"
              >
                {marker}
              </a>
              {after}
            </>
          );
        })()}
      </p>
      {endpointEnabled && (
        <div className="mt-3 max-w-xl border border-line/80 bg-paper/40 rounded-sm px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted/80 mb-1">{ui(lang, 'sourceNoteLabel')}</div>
          <p className="text-[11.5px] leading-relaxed text-muted/90">
            {ui(lang, 'sourcePublicNote')}
          </p>
        </div>
      )}
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
function DemographicScreen({ lang, step, spec, value, onChange, onNext, onBack }) {
  const displaySpec = localizeDemographic(spec, lang);
  return (
    <div className="pt-10 sm:pt-16">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-3">
        {ui(lang, 'contextPart')} · {step + 1}/{DATA.demographics.length} <span className="text-ink/30">·</span> {ui(lang, 'unscored')}
      </div>
      <h2 className="font-display font-medium text-[24px] sm:text-[28px] leading-[1.2] tracking-tight text-balance mb-8">
        {displaySpec.label}
      </h2>

      <fieldset className="space-y-2.5">
        <legend className="sr-only">{displaySpec.label}</legend>
        {spec.options.map((opt, i) => {
          const selected = value === opt;
          return (
            <RadioRow
              key={i}
              checked={selected}
              onSelect={() => onChange(opt)}
              label={displaySpec.displayOptions?.[i] || opt}
              name={'demo-' + spec.id}
            />
          );
        })}
      </fieldset>

      <NavRow
        onBack={onBack}
        onNext={onNext}
        canNext={!!value}
        backLabel={ui(lang, 'back')}
        nextLabel={step === DATA.demographics.length - 1 ? ui(lang, 'startEvaluation') : ui(lang, 'next')}
      />
    </div>
  );
}

/* ------------------------- question -------------------------------- */
function QuestionScreen({ lang, sessionId, index, total, question, value, onChange, onNext, onBack, isLast, nextLabel }) {
  const [popover, setPopover] = useState(false);
  const displayQuestion = localizeQuestion(question, lang);
  const group = getGroup(question.group, lang);
  const openResponse = question.open_response
    ? { ...localizeOpenResponse(lang), ...question.open_response }
    : localizeOpenResponse(lang);

  // Stable shuffle keyed by session + question id
  const shuffledOptions = useMemo(() => {
    const seed = hashStr(sessionId + ':q' + question.id);
    return seededShuffle(displayQuestion.options.map((o, i) => ({ ...o, originalIndex: i })), seed);
  }, [sessionId, question.id, lang]);

  const NA = {
    level: null,
    score: 0,
    text: localizeNA(lang) || 'N/A',
    isNA: true,
  };
  const updateAnswer = (patch) => onChange({ ...(value || {}), ...patch });
  const hasChoice = hasQuestionChoice(value);

  return (
    <div className="pt-10 sm:pt-16">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            {ui(lang, 'question')} {index + 1} / {total} <span className="text-ink/30 mx-1">·</span> {displayQuestion.short}
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
          aria-label={ui(lang, 'commonInfo')}
          aria-expanded={popover}
          className={`relative w-8 h-8 grid place-items-center rounded-full transition-colors ${popover ? 'bg-ink text-paper' : 'text-muted hover:text-ink hover:bg-line/40'}`}
        >
          <InfoIcon size={16} />
        </button>
      </div>

      <h2 className="font-display font-medium text-[22px] sm:text-[26px] leading-[1.25] tracking-tight text-balance">
        {displayQuestion.text}
      </h2>

      {popover && (
        <div role="region" aria-label={ui(lang, 'commonInfo')} className="mt-5 border-l-2 border-ink pl-4 py-2 bg-line/30 rounded-r-sm">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1.5 flex items-center justify-between">
            <span>{ui(lang, 'commonInfo')}</span>
            <button onClick={() => setPopover(false)} className="text-muted hover:text-ink" aria-label={ui(lang, 'close')}>
              <X size={12} />
            </button>
          </div>
          <p className="text-[13px] leading-relaxed text-ink/85">{displayQuestion.note}</p>
        </div>
      )}

      <fieldset className="mt-8 space-y-2.5">
        <legend className="sr-only">{displayQuestion.text}</legend>
        {shuffledOptions.map((opt, displayIdx) => {
          const selected = !!(value && value.level === opt.level && value.originalIndex === opt.originalIndex && !value.isNA);
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
            {openResponse.label || ui(lang, 'optionalContext')}
          </label>
          <textarea
            id={'comment-' + question.id}
            value={value?.comment || ''}
            onChange={(e) => updateAnswer({ comment: e.target.value })}
            placeholder={openResponse.placeholder || ui(lang, 'contextPlaceholder')}
            rows={3}
            className="w-full resize-y rounded-sm border border-line bg-paper px-4 py-3 text-[14px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-ink/50 transition-colors"
          />
        </div>
      )}

      <NavRow
        onBack={onBack}
        onNext={onNext}
        canNext={hasChoice}
        backLabel={ui(lang, 'back')}
        nextLabel={nextLabel || (isLast ? ui(lang, 'finishAndSeeResults') : ui(lang, 'next'))}
      />
    </div>
  );
}

/* ------------------------- survey feedback -------------------------- */
function SurveyFeedbackScreen({ lang, value, onChange, onNext, onBack }) {
  const spec = localizeFeedback(lang);
  return (
    <div className="pt-10 sm:pt-16">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-3">
        {spec.eyebrow || ui(lang, 'feedbackResume')}
      </div>
      <h2 className="font-display font-medium text-[24px] sm:text-[28px] leading-[1.2] tracking-tight text-balance mb-4">
        {spec.title || ui(lang, 'feedbackResume')}
      </h2>
      {spec.description && (
        <p className="text-[15px] text-ink/80 leading-relaxed max-w-xl">
          {spec.description}
        </p>
      )}

      {<div className="mt-5 border-l-2 border-line pl-4 py-3 bg-line/20 rounded-r-sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted mb-1.5">
          {ui(lang, 'feedbackSafetyTitle')}
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">
          {ui(lang, 'feedbackSafetyNote')}
        </p>
      </div>}
      
      <div className="mt-8">
        <label
          htmlFor="survey-feedback"
          className="block font-mono text-[10px] uppercase tracking-[0.18em] text-muted mb-2"
        >
          {spec.title || ui(lang, 'feedbackResume')}
        </label>
        <textarea
          id="survey-feedback"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.placeholder || ui(lang, 'contextPlaceholder')}
          rows={7}
          className="w-full resize-y rounded-sm border border-line bg-paper px-4 py-3 text-[14px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-ink/50 transition-colors"
        />
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        {ui(lang, 'feedbackOptional')}
      </p>

      <NavRow
        onBack={onBack}
        onNext={onNext}
        canNext={true}
        backLabel={ui(lang, 'back')}
        nextLabel={ui(lang, 'finishAndSeeResults')}
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
function NavRow({ onBack, onNext, canNext, nextLabel, backLabel = 'Quay lại' }) {
  return (
    <div className="mt-10 flex items-center justify-between gap-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm text-muted hover:text-ink transition-colors"
      >
        <ChevronLeft size={16} /> {backLabel}
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
function SavedToast({ visible, lang }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 transition-all duration-300
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}
    >
      <div className="flex items-center gap-2 px-3.5 py-2 bg-ink text-paper text-[12px] font-medium rounded-full shadow-md">
        <SaveIcon size={13} stroke={2} />
        {ui(lang, 'savedProgress')}
      </div>
    </div>
  );
}

/* ============================ RESULTS ============================== */
function computeSummary(answers, demographics, lang = 'vi') {
  const scored = DATA.questions.map(q => {
    const displayQuestion = localizeQuestion(q, lang);
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
      topic: displayQuestion.topic,
      short: displayQuestion.short,
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
  const tier = localizeTier(tierFor(percent), lang);
  const groupSummaries = computeGroupSummaries(scored, lang);
  const warnings = computeWarnings(scored, demographics, { total, maxScore, percent, groupSummaries }, lang);
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

function computeGroupSummaries(scored, lang = 'vi') {
  const groups = DATA.groups || [];
  return groups.map(group => {
    const displayGroup = localizeGroup(group, lang);
    const items = scored.filter(s => s.group === group.id);
    const total = items.reduce((sum, item) => sum + item.points, 0);
    const maxScore = items.reduce((sum, item) => sum + item.maxPoints, 0);
    const percent = maxScore > 0 ? (total / maxScore) * 100 : 0;
    return {
      ...displayGroup,
      questionCount: items.length,
      applicableCount: items.filter(item => item.answered && !item.isNA).length,
      total,
      maxScore,
      percent,
      score: percent / 20,
    };
  });
}

function collectOpenResponses(answers, lang = 'vi') {
  return DATA.questions
    .map(q => {
      const displayQuestion = localizeQuestion(q, lang);
      return {
        questionId: q.id,
        group: q.group,
        topic: displayQuestion.topic,
        comment: (answers[q.id]?.comment || '').trim(),
      };
    })
    .filter(r => r.comment);
}

function buildSubmission(sessionId, demographics, answers, surveyFeedback = '', lang = 'vi') {
  return {
    sessionId,
    language: lang,
    submittedAt: new Date().toISOString(),
    demographics,
    answers, // anonymized — no PII collected
    openResponses: collectOpenResponses(answers, lang),
    surveyFeedback: (surveyFeedback || '').trim(),
    summary: computeSummary(answers, demographics, lang),
  };
}

function computeWarnings(scored, demographics, summary, lang = 'vi') {
  const get = (id) => scored.find(s => s.id === id);
  const warnings = [];
  const q1 = get(1), q3 = get(3), q5 = get(5), q6 = get(6), q7 = get(7), q9 = get(9), q10 = get(10), q11 = get(11), q12 = get(12), q14 = get(14), q15 = get(15);

  if (q1?.level >= 4 && q11?.level != null && q11.level <= 2) {
    warnings.push({
      key: 'q1-q11',
      title: ui(lang, 'warnEstimateCostTitle'),
      detail: ui(lang, 'warnEstimateCostDetail'),
      refs: [1, 11],
    });
  }
  if (q1?.level >= 4 && ((q14?.level != null && q14.level <= 2) || (q15?.level != null && q15.level <= 2))) {
    warnings.push({
      key: 'q1-q14-q15',
      title: ui(lang, 'warnEstimateReadinessTitle'),
      detail: ui(lang, 'warnEstimateReadinessDetail'),
      refs: [1, 14, 15],
    });
  }
  if (q14?.level >= 4 && q15?.level != null && q15.level <= 2) {
    warnings.push({
      key: 'q14-q15',
      title: ui(lang, 'warnTaskReadinessTitle'),
      detail: ui(lang, 'warnTaskReadinessDetail'),
      refs: [14, 15],
    });
  }
  if (q3?.level >= 4 && q10?.level != null && q10.level <= 2) {
    warnings.push({
      key: 'q3-q10',
      title: ui(lang, 'warnDefectEvalTitle'),
      detail: ui(lang, 'warnDefectEvalDetail'),
      refs: [3, 10],
    });
  }
  if (q6?.level >= 4 && q9?.level != null && q9.level <= 2) {
    warnings.push({
      key: 'q6-q9',
      title: ui(lang, 'warnHarnessSecurityTitle'),
      detail: ui(lang, 'warnHarnessSecurityDetail'),
      refs: [6, 9],
    });
  }
  if (q7?.level >= 4 && q10?.level != null && q10.level <= 2) {
    warnings.push({
      key: 'q7-q10',
      title: ui(lang, 'warnModelEvalTitle'),
      detail: ui(lang, 'warnModelEvalDetail'),
      refs: [7, 10],
    });
  }
  const teamSmall = demographics.a2 === '1–3 người' || demographics.a2 === '4–10 người';
  const newProject = demographics.a3 === '<3 tháng';
  if (q5?.level >= 4 && teamSmall && newProject) {
    warnings.push({
      key: 'q5-context',
      title: ui(lang, 'warnSkillContextTitle'),
      detail: ui(lang, 'warnSkillContextDetail'),
      refs: [5],
    });
  }
  // Q12 L2 anti-pattern
  if (q12?.level === 2) {
    warnings.push({
      key: 'q12-l2',
      title: ui(lang, 'warnParallelSwarmTitle'),
      detail: ui(lang, 'warnParallelSwarmDetail'),
      refs: [12],
    });
  }
  const naCount = scored.filter(s => s.isNA).length;
  if (naCount >= 4) {
    warnings.push({
      key: 'many-na',
      title: ui(lang, 'warnManyNaTitle'),
      detail: ui(lang, 'warnManyNaDetail', { naCount }),
      refs: scored.filter(s => s.isNA).map(s => s.id),
    });
  }
  return warnings;
}

function ResultScreen({ demographics, answers, surveyFeedback, lang, sessionId, onRestart, submitState, submitError, onRetry, endpointEnabled, deploy, dark }) {
  const summary = useMemo(() => computeSummary(answers, demographics, lang), [answers, demographics, lang]);
  const { scored, total, maxScore, percent, tier, warnings, groupSummaries, applicableCount, totalQuestions } = summary;
  const scoringNote = localizeScoringNote(lang);
  const weightGuidance = (DATA.scoring?.weight_guidance || []).map(item => localizeWeightGuidance(item, lang));

  const [focusedGroup, setFocusedGroup] = useState(null);
  const breakdownRef = useRef(null);

  // When user picks a group on the radar, scroll the matching block into view.
  useEffect(() => {
    if (!focusedGroup || !breakdownRef.current) return;
    const el = breakdownRef.current.querySelector(`[data-group="${focusedGroup}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusedGroup]);

  const handleDownload = () => {
    const payload = {
      meta: {
        survey: localizeSurvey(lang, 'title') || 'AI Integration Maturity Survey v1.0',
        language: lang,
        sessionId,
        submittedAt: new Date().toISOString(),
      },
      demographics,
      responses: DATA.questions.map(q => {
        const displayQuestion = localizeQuestion(q, lang);
        const a = answers[q.id];
        const selectedOption = Number.isInteger(a?.originalIndex) && a.originalIndex >= 0
          ? displayQuestion.options[a.originalIndex]
          : null;
        const scoredItem = scored.find(s => s.id === q.id);
        const group = getGroup(q.group, lang);
        return {
          questionId: q.id,
          groupId: q.group,
          groupName: group?.name || q.group,
          topic: displayQuestion.topic,
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
      openResponses: collectOpenResponses(answers, lang),
      surveyFeedback: (surveyFeedback || '').trim(),
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
        <span>{ui(lang, 'results')} · {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'vi-VN')}</span>
      </div>

      <h1 className="font-display font-medium text-[34px] sm:text-[44px] leading-[1.05] tracking-tight text-balance mb-2">
        {ui(lang, 'profile')}: <span className="text-accent">{tier.name}</span>
      </h1>
      <p className="text-[15px] text-ink/80 leading-relaxed max-w-xl">
        {tier.recommendation}
      </p>

      {endpointEnabled && (
        <SubmissionBanner lang={lang} state={submitState} error={submitError} onRetry={onRetry} sessionId={sessionId} />
      )}

      {/* Score block */}
      <div className="mt-10 grid grid-cols-2 gap-6 sm:gap-8 border-t border-b border-line/60 py-8">
        <ScoreStat label={ui(lang, 'totalScore')} value={formatScore(total)} suffix={`/ ${formatScore(maxScore)}`} />
        <ScoreStat label={ui(lang, 'percent')} value={percent.toFixed(0)} suffix="/ 100%" />
      </div>
      <p className="mt-3 text-[12px] text-muted leading-relaxed">
        {ui(lang, 'maxScoreNote', { applicableCount, totalQuestions })}
      </p>
      {(scoringNote || weightGuidance.length > 0) && (
        <div className="mt-4 border-l-2 border-line pl-4 py-1 max-w-2xl">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
            {ui(lang, 'scoringTitle')}
          </div>
          {scoringNote && (
            <p className="text-[12px] leading-relaxed text-muted whitespace-pre-line">
              {scoringNote}
            </p>
          )}
          {weightGuidance.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {weightGuidance.map(item => (
                <div key={item.weight} className="text-[12px] leading-relaxed text-ink/75">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 border border-line rounded-sm text-muted mr-2">w{item.weight}</span>
                  <span className="font-medium text-ink/85">{item.label}:</span> {item.description}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Radar */}
      <section className="mt-12">
        <SectionTitle eyebrow={ui(lang, 'radarEyebrow', { count: groupSummaries.length })} title={ui(lang, 'radarTitle')} />
        <div className="mt-6 -mx-3 sm:-mx-6">
          <RadarBlock
            groupSummaries={groupSummaries}
            scored={scored}
            focusedGroup={focusedGroup}
            onFocusChange={setFocusedGroup}
            dark={dark}
            lang={lang}
          />
        </div>
      </section>

      {/* Warnings — creator-only (preview mode). In DEPLOY=true these are hidden
          from participants but still included in the email payload sent to the creator. */}
      {!deploy && warnings.length > 0 && (
        <section className="mt-14">
          <div className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-warn border border-warn/40 rounded-sm px-2 py-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn"></span>
            {ui(lang, 'preview')}
          </div>
          <SectionTitle eyebrow={ui(lang, 'signalsFound', { count: warnings.length })} title={ui(lang, 'reviewSignals')} />
          <p className="mt-4 text-[14px] text-ink/75 leading-relaxed max-w-2xl">
            {ui(lang, 'falseHighCopy')}
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
            {ui(lang, 'internalSignalCopy')}
          </p>
        </section>
      )}

      {/* Per-topic breakdown — creator-only (preview mode). Participants chỉ thấy radar. */}
      {!deploy && (
        <section className="mt-14" ref={breakdownRef}>
          <div className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-warn border border-warn/40 rounded-sm px-2 py-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn"></span>
            {ui(lang, 'preview')}
          </div>
          <SectionTitle eyebrow={ui(lang, 'detailEyebrow', { count: DATA.questions.length })} title={ui(lang, 'detailTitle')} />
          <p className="mt-3 text-[13px] text-muted leading-relaxed max-w-2xl">
            {ui(lang, 'detailInstruction', { groupCount: groupSummaries.length })}
          </p>

          <div className="mt-8 space-y-10">
            {groupSummaries.map(g => {
              const items = scored
                .map((s, idx) => ({ s, q: DATA.questions[idx] }))
                .filter(({ q }) => q.group === g.id);
              const isFocused = focusedGroup === g.id;
              return (
                <div
                  key={g.id}
                  data-group={g.id}
                  className={`scroll-mt-6 transition-all ${isFocused ? 'ring-2 ring-accent ring-offset-4 ring-offset-paper rounded-sm' : ''}`}
                >
                  <header className="border-b border-line pb-3 mb-4 flex items-baseline justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted mb-1">
                        {ui(lang, 'group')} · {items.length} {ui(lang, 'questions').toLowerCase()}
                      </div>
                      <h3 className="font-display font-medium text-[19px] sm:text-[22px] leading-tight tracking-tight">
                        {g.name}
                      </h3>
                    </div>
                    <div className="font-mono text-[12px] text-muted tabular-nums whitespace-nowrap">
                      {g.percent.toFixed(0)}% · {formatScore(g.total)}/{formatScore(g.maxScore)} {ui(lang, 'points')}
                    </div>
                  </header>

                  <ol className="space-y-3">
                    {items.map(({ s, q }) => {
                      const displayQuestion = localizeQuestion(q, lang);
                      const a = answers[q.id];
                      const selectedOption = Number.isInteger(a?.originalIndex) && a.originalIndex >= 0
                        ? displayQuestion.options[a.originalIndex]
                        : null;
                      return (
                        <li key={s.id} className="border border-line rounded-sm bg-paper">
                          <div className="px-4 sm:px-5 py-4 flex items-start gap-4">
                            <div className="font-mono text-[11px] text-muted pt-0.5 w-6 shrink-0 tabular-nums">
                              {String(s.id).padStart(2, '0')}
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* Topic + score row */}
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="font-display font-medium text-[15px] leading-snug">{displayQuestion.topic}</div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <LevelDots score={s.level || 0} />
                                  <div className="font-mono text-[11px] text-muted tabular-nums">
                                    {s.isNA
                                      ? `N/A · w${s.weight}`
                                      : `L${s.level} · ${formatScore(s.points)}/${formatScore(s.maxPoints)} · w${s.weight}`}
                                  </div>
                                </div>
                              </div>

                              {/* Question text */}
                              <p className="mt-3 text-[13px] leading-relaxed text-ink/75">
                                <span className="font-mono uppercase tracking-wider text-[10px] text-muted mr-1.5">{ui(lang, 'ask')}</span>
                                {displayQuestion.text}
                              </p>

                              {/* Selected option */}
                              {selectedOption ? (
                                <p className="mt-2 text-[13px] leading-relaxed text-ink/90 border-l-2 border-accent pl-3 py-0.5 bg-accent-soft/40">
                                  <span className="font-mono uppercase tracking-wider text-[10px] text-accent mr-1.5">{ui(lang, 'selectedLevel', { level: selectedOption.level })}</span>
                                  {selectedOption.text}
                                </p>
                              ) : s.isNA ? (
                                <p className="mt-2 text-[13px] leading-relaxed text-muted border-l-2 border-line pl-3 py-0.5">
                                  <span className="font-mono uppercase tracking-wider text-[10px] mr-1.5">{ui(lang, 'selected')}</span>
                                  {localizeNA(lang) || 'N/A'}
                                </p>
                              ) : null}

                              {/* Respondent's open response */}
                              {s.comment && (
                                <p className="mt-2 text-[12.5px] leading-relaxed text-ink/75 border-l-2 border-line pl-3 py-0.5">
                                  <span className="font-mono uppercase tracking-wider text-[10px] text-muted mr-1.5">{ui(lang, 'context')}</span>
                                  {s.comment}
                                </p>
                              )}

                              {/* Author note */}
                              <p className="mt-2 text-[12.5px] leading-relaxed text-ink/65 italic">
                                <span className="not-italic font-mono uppercase tracking-wider text-[10px] text-muted mr-1.5">{ui(lang, 'note')}</span>
                                {displayQuestion.note}
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Actions */}
      <div className="mt-14 flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleDownload}
          className="flex-1 inline-flex items-center justify-between gap-2 px-5 py-4 bg-ink text-paper rounded-sm hover:bg-ink/90 transition-colors"
        >
          <span className="font-medium text-sm">{ui(lang, 'downloadJson')}</span>
          <Download size={16} />
        </button>
        <button
          onClick={onRestart}
          className="inline-flex items-center justify-center gap-2 px-5 py-4 border border-line text-ink rounded-sm hover:border-ink/40 hover:bg-line/30 transition-colors"
        >
          <RotateCcw size={16} />
          <span className="font-medium text-sm">{ui(lang, 'restart')}</span>
        </button>
      </div>

      <p className="mt-8 text-[12px] text-muted leading-relaxed">
        {endpointEnabled
          ? <>{ui(lang, 'sentFooter')}</>
          : <>{ui(lang, 'localFooter')}</>
        } Session ID: <span className="font-mono">{sessionId}</span>.
      </p>
    </div>
  );
}

function SubmissionBanner({ lang, state, error, onRetry, sessionId }) {
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
          <span className="text-ink/80">{ui(lang, 'sending')}</span>
        )}
        {isSent && (
          <span className="text-ink/85">
            {ui(lang, 'sent')} <span className="font-mono text-[11px] text-muted">ID: {sessionId.slice(0, 16)}</span>
          </span>
        )}
        {isError && (
          <div>
            <div className="text-ink/85 mb-1.5">
              {ui(lang, 'sendError')}
            </div>
            {error && (
              <div className="font-mono text-[10.5px] text-muted break-all mb-2">{error}</div>
            )}
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 text-[12px] text-ink underline underline-offset-4 hover:no-underline"
            >
              <RotateCcw size={12} /> {ui(lang, 'retrySend')}
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

function RadarBlock({ groupSummaries, scored, focusedGroup, onFocusChange, dark, lang }) {
  // Mobile responsive height
  const [height, setHeight] = useState(420);
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setHeight(w < 640 ? 380 : w < 768 ? 440 : 500);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const inkColor    = dark ? '#f5f0e6' : '#1c2230';
  const mutedColor  = dark ? '#7a7e88' : '#a8a39a';
  const lineColor   = dark ? '#4a4f5a' : '#dfd9cd';
  const accentColor = dark ? '#9fcfd4' : '#3a6f76';

  const inDetailMode = !!focusedGroup;

  // Overview: 5 group-level axes, score on the 0–5 scale derived from percent.
  const overviewRows = groupSummaries.map(g => ({
    key: g.id,
    groupId: g.id,
    axisLabel: g.short,
    fullLabel: g.name,
    score: g.score,
  }));

  // Detail: 16 question-level axes, ordered by group so each group occupies a
  // contiguous arc — easier to "see" which axes belong together.
  const groupOrder = Object.fromEntries(groupSummaries.map((g, i) => [g.id, i]));
  const detailRows = scored
    .slice()
    .sort((a, b) => (groupOrder[a.group] - groupOrder[b.group]) || (a.id - b.id))
    .map(s => ({
      key: 'q' + s.id,
      groupId: s.group,
      axisLabel: s.short || ('Q' + s.id),
      fullLabel: s.topic,
      score: s.isNA ? 0 : (s.level || 0),
      isNA: s.isNA,
    }));

  const rows = inDetailMode ? detailRows : overviewRows;

  // Click logic:
  // - overview: any click → enter detail mode focused on that group
  // - detail: click on focused group's axis → no-op; otherwise → back to overview
  function handleAxisClick(row) {
    if (!row) return;
    if (!inDetailMode) {
      onFocusChange(row.groupId);
      return;
    }
    if (row.groupId === focusedGroup) return;
    onFocusChange(null);
  }

  // Custom tick renderer with click handler.
  const Tick = ({ payload, x, y, textAnchor, ...rest }) => {
    const row = rows.find(r => r.axisLabel === payload.value);
    if (!row) return null;
    const focused = !inDetailMode || row.groupId === focusedGroup;
    return (
      <g
        onClick={() => handleAxisClick(row)}
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        aria-label={`${row.fullLabel} — ${inDetailMode ? (focused ? ui(lang, 'radarExitDetail') : ui(lang, 'radarBackOverview')) : ui(lang, 'radarViewGroup')}`}
      >
        {/* Invisible hit area for easier tapping */}
        <rect
          x={x - 38} y={y - 12}
          width={76} height={24}
          fill="transparent"
        />
        <text
          x={x} y={y}
          textAnchor={textAnchor}
          fill={focused ? inkColor : mutedColor}
          fontSize={focused ? (inDetailMode ? 10.5 : 12) : 9.5}
          fontWeight={focused ? 600 : 400}
          fontFamily="IBM Plex Mono, ui-monospace, monospace"
          opacity={focused ? 1 : 0.6}
          style={{ userSelect: 'none' }}
        >
          {payload.value}
        </text>
      </g>
    );
  };

  // Custom dot renderer — in detail mode, focused group's dots are emphasized.
  const Dot = (props) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return null;
    const row = rows[index];
    if (!row) return null;
    if (row.isNA) {
      // N/A: hollow ring, muted
      return <circle cx={cx} cy={cy} r={3} fill="none" stroke={mutedColor} strokeWidth={1.2} />;
    }
    const focused = !inDetailMode || row.groupId === focusedGroup;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={focused ? (inDetailMode ? 4.5 : 3.5) : 2.5}
        fill={focused ? accentColor : mutedColor}
        opacity={focused ? 1 : 0.5}
        strokeWidth={0}
      />
    );
  };

  const focusedGroupData = focusedGroup
    ? groupSummaries.find(g => g.id === focusedGroup)
    : null;

  return (
    <div>
      {/* Interaction hint / focus state header */}
      <div className="mb-3 px-3 sm:px-6 min-h-[44px] flex items-center justify-between gap-3 flex-wrap">
        {inDetailMode && focusedGroupData ? (
          <>
            <div className="flex items-baseline gap-3 flex-wrap">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{ui(lang, 'currentlyViewing')}</div>
                <div className="font-display font-medium text-[16px] leading-tight">{focusedGroupData.name}</div>
              </div>
              <div className="font-mono text-[12px] text-muted tabular-nums">
                {focusedGroupData.percent.toFixed(0)}% · {ui(lang, 'applicableQuestions', { applicableCount: focusedGroupData.applicableCount, questionCount: focusedGroupData.questionCount })}
              </div>
            </div>
            <button
              onClick={() => onFocusChange(null)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-muted hover:text-ink border border-line hover:border-ink/40 rounded-sm transition-colors"
            >
              <X size={11} /> {ui(lang, 'backToOverview')}
            </button>
          </>
        ) : (
          <div className="font-mono text-[11px] text-muted">
            {ui(lang, 'radarHint', { groupCount: groupSummaries.length, dimensionCount: scored.length })}
          </div>
        )}
      </div>

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <RadarChart data={rows} outerRadius={inDetailMode ? '68%' : '72%'} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
            <PolarGrid stroke={lineColor} />
            <PolarAngleAxis
              dataKey="axisLabel"
              tick={<Tick />}
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
              fillOpacity={inDetailMode ? 0.12 : 0.18}
              strokeWidth={1.5}
              dot={<Dot />}
              isAnimationActive={true}
              animationDuration={300}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ============================ mount ================================ */
window.Survey = Survey;
