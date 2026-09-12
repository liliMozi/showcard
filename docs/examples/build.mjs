/** Build the website packages from the checked-in recipe sources. Run from any directory. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { injectRuntimeIntoDocument, CARD_CONTENT_SECURITY_POLICY } from '../../reference/src/wrap.js';

const root = dirname(fileURLToPath(import.meta.url));
const languages = ['en', 'zh', 'ja', 'ko'];
const examples = ['weather', 'piano', 'note', 'todo'];
const copy = {
  en: { place: 'Shanghai', title: 'A little room to think', body: 'Leave the morning open.\n\nWalk by the river, stop for a coffee, and write down the idea that keeps returning.\n\nSome things only need a little room.', list: 'A slower Sunday', items: ['Pick up a notebook', 'Walk along the river', 'Leave time for nothing'], sample: 'Sample weather data', demo: 'Edits reset on reload.', local: 'Saved in this browser.', unavailable: 'This demo cannot reach host tools.' },
  zh: { place: '上海', title: '留一点空白', body: '把早晨留出来。\n\n沿着江边走走，找一家咖啡店坐下，把那个反复出现的念头写下来。\n\n有些事，只需要一点空白。', list: '慢一点的周日', items: ['带上一本笔记本', '沿江散步', '留一点发呆的时间'], sample: '示例天气', demo: '刷新后编辑将重置。', local: '已保存在此浏览器。', unavailable: '此网页演示无法调用宿主工具。' },
  ja: { place: '上海', title: '少しの余白', body: '朝は予定を入れずに。\n\n川沿いを歩いて、コーヒーを飲みながら、何度も浮かぶ考えを書き留める。\n\n少しの余白があればいい。', list: 'ゆっくり過ごす日曜日', items: ['ノートを持っていく', '川沿いを散歩する', '何もしない時間を残す'], sample: '天気のサンプル', demo: '再読み込みすると編集内容は消えます。', local: 'このブラウザーに保存済み。', unavailable: 'このデモではホストのツールを使えません。' },
  ko: { place: '상하이', title: '작은 여백', body: '아침은 비워 두세요.\n\n강변을 걷고, 커피를 마시며 자꾸 떠오르는 생각을 적어 보세요.\n\n조금의 여백이면 충분해요.', list: '느긋한 일요일', items: ['공책 챙기기', '강변 산책하기', '아무것도 하지 않을 시간 남기기'], sample: '예시 날씨', demo: '새로고침하면 편집 내용이 초기화돼요.', local: '이 브라우저에 저장했어요.', unavailable: '이 데모에서는 호스트 도구를 사용할 수 없어요.' },
};
const theme = `<style data-showcase-theme>
:root{color-scheme:light;--bg:#F8F4ED;--bg-card:#FCFAF5;--text:#3B3D3F;--text-light:#68655F;--text-muted:#8A847A;--border:#E3DED2;--accent:#537D96;--accent-hover:#42657B;--accent-light:rgba(83,125,150,.1);--overlay-subtle:rgba(59,61,63,.04);--font-serif:Georgia,'Songti SC','Noto Serif CJK SC',serif;--font-ui:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans','Malgun Gothic',sans-serif;--font-mono:ui-monospace,SFMono-Regular,monospace;--radius-card:12px;--control-radius:8px;--corner-radius-scale:1}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--bg-card);color:var(--text);font-family:var(--font-serif);font-size:15px;line-height:1.6}button,input,textarea{font:inherit}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent)!important;outline-offset:2px}[hidden]{display:none!important}
html[data-card-sizing="viewport"] body{overflow:auto}
html[data-card-sizing="viewport"] .weather-hero{max-height:calc(100% - 180px);min-height:180px}
</style>`;
const csp = CARD_CONTENT_SECURITY_POLICY.replace('img-src data: blob:', "img-src 'self' data: blob:");
for (const name of examples) {
  const source = await readFile(join(root, name, 'source.html'), 'utf8');
  for (const language of languages) {
    const words = copy[language];
    const state = { uiLanguage: language };
    if (name === 'note') Object.assign(state, { title: words.title, body: words.body });
    if (name === 'todo') Object.assign(state, { title: words.list, items: words.items.map((text, index) => ({ text, done: index === 0 })) });
    if (name === 'weather') state.weather = {
      place: { name: words.place, latitude: 31.23, longitude: 121.47 },
      reading: { temperature: 26, humidity: 68, wind: 12, code: 2, days: [
        { date: '2026-09-12', code: 2, high: 28, low: 23 },
        { date: '2026-09-13', code: 0, high: 29, low: 22 },
        { date: '2026-09-14', code: 3, high: 27, low: 23 },
      ] },
    };
    let document = source.replace(/<script\b[^>]*data-card-state[^>]*>[\s\S]*?<\/script>\s*/g, '');
    document = document.replace('<html>', `<html lang="${language}" data-card-sizing="viewport">`);
    document = document.replace('</head>', `${theme}\n<script type="application/json" data-card-state>${JSON.stringify(state)}</script>\n</head>`);
    // The recipe owns controls and layout. Only the website's demonstration notice is added here.
    const notice = name === 'note' || name === 'todo' ? words.demo : '';
    if (name === 'weather') document = document.replace(/"weather.host":"[^"]*"/g, '"weather.host":' + JSON.stringify(words.sample));
    const startup = `<script>
if(window.parent===window){
  window.card.state.get().then(function(envelope){
    if(envelope.ok && Object.keys(envelope.result.state || {}).length === 0){
      return window.card.state.set(JSON.parse(document.querySelector('[data-card-state]').textContent));
    }
  });
}
document.addEventListener('DOMContentLoaded',function(){
  var text=window.parent===window ? ${JSON.stringify(name === 'note' || name === 'todo' ? words.local : '')} : ${JSON.stringify(notice)};
  if(text){var p=document.createElement('p');p.textContent=text;p.style.cssText='font:11px/1.5 var(--font-ui);color:var(--text-muted);margin:0;padding:8px 20px 12px;flex:none';document.body.appendChild(p)}
});
</script>`;
    document = injectRuntimeIntoDocument(document, { csp }).replace('</head>', `${startup}</head>`);
    await writeFile(join(root, name, language === 'en' ? 'index.html' : `index.${language}.html`), document);
  }
}
await mkdir(join(root, 'runtime'), { recursive: true });
for (const file of ['host.js', 'codes.js', 'wrap.js', 'runtime-source.js', 'placeholder-source.js']) {
  await copyFile(join(root, '../../reference/src', file), join(root, 'runtime', file));
}
console.log('Built four recipe packages in four languages, with the reference runtime.');

await import('./build-legacy.mjs');
