// Loads survey content from survey-content.yaml at runtime.
// Edit the YAML; refresh — no rebuild needed.
(function loadSurveyData() {
  const yamlUrl = 'survey-content.yaml';
  fetch(yamlUrl)
    .then(r => {
      if (!r.ok) throw new Error('Failed to load ' + yamlUrl + ': ' + r.status);
      return r.text();
    })
    .then(text => {
      if (!window.jsyaml) {
        throw new Error('js-yaml not loaded — check index.html script order.');
      }
      const parsed = window.jsyaml.load(text);
      // basic shape check
      if (!parsed?.questions || !parsed?.demographics || !parsed?.tiers) {
        throw new Error('survey-content.yaml is missing top-level keys (demographics / questions / tiers).');
      }
      window.SURVEY_DATA = parsed;
    })
    .catch(err => {
      console.error('[survey] data load failed:', err);
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = `
          <div style="font-family:'IBM Plex Sans',system-ui,sans-serif;max-width:560px;margin:80px auto;padding:24px;border-left:3px solid #c44;background:#fef6f4;color:#222;line-height:1.6;">
            <div style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#a44;margin-bottom:8px;">Lỗi tải dữ liệu survey</div>
            <div style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px;white-space:pre-wrap;">${String(err.message || err)}</div>
            <div style="margin-top:16px;font-size:13px;color:#555;">Kiểm tra file <code>survey-content.yaml</code> có tồn tại và đúng cú pháp YAML.</div>
          </div>`;
      }
    });
})();
