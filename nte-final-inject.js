// ================= FINAL INJECT SCRIPT：NTE-TTS 三级TTS + 音频竞态BUG修复 + iOS Safari补丁 =================
(function injectFinalNteTTS(){
    // 注入播放按钮CSS
    const style = document.createElement('style');
    style.textContent = `
.lab-play-btn{
  padding:4px 8px;
  margin:0 6px;
  border-radius:4px;
  border:1px solid #ccc;
  background:#f8f8f8;
  cursor:pointer;
}
.lab-play-btn:active{
  background:#e9e9e9;
}
.lab-play-btn:disabled{
  opacity:0.5;
  cursor:not-allowed;
}
    `;
    document.head.appendChild(style);

    // 注入TTS核心逻辑
    const coreScript = document.createElement('script');
    coreScript.textContent = `
window.NTE_TTS = (function() {
  const state = {
    currentPlayToken: null,
    esVoice: null,
    voiceLoaded: false,
    isBusy: false
  };

  // 检测西语系统音色
  function detectSpanishVoice() {
    const voices = speechSynthesis.getVoices();
    state.esVoice = voices.find(v => v.lang.startsWith("es"));
    state.voiceLoaded = !!state.esVoice;
  }
  speechSynthesis.onvoiceschanged = detectSpanishVoice;
  detectSpanishVoice();

  function generatePlayToken() {
    return Math.random().toString(36).slice(2);
  }

  // 全局停止音频
  function stopAllAudio() {
    speechSynthesis.cancel();
    if (state.currentPlayToken?.audioEl) {
      state.currentPlayToken.audioEl.pause();
      state.currentPlayToken.audioEl.currentTime = 0;
    }
    state.currentPlayToken = null;
    state.isBusy = false;
  }

  /**
   * @param {string} esText 纯西语文本
   * @param {string|null} preMp3Url 预合成MP3地址，长段落必填
   * @param {Function} onEnd 播放结束回调
   * @param {Function} onError 错误回调
   * @returns {string|null} playToken
   */
  function playSpanish(esText, preMp3Url = null, onEnd = ()=>{}, onError = ()=>{}) {
    if(state.isBusy) return null;
    stopAllAudio();
    const token = generatePlayToken();
    state.currentPlayToken = { id: token };
    state.isBusy = true;

    if (state.voiceLoaded && state.esVoice) {
      const utter = new SpeechSynthesisUtterance(esText);
      utter.voice = state.esVoice;
      utter.lang = "es-ES";
      utter.rate = 0.95;
      utter.onend = () => {
        if (state.currentPlayToken?.id === token) {
          state.currentPlayToken = null;
          state.isBusy = false;
          onEnd();
        }
      };
      utter.onerror = (err) => {
        if (state.currentPlayToken?.id === token) {
          if(preMp3Url) playMp3(preMp3Url, token, onEnd, onError);
          else {
            state.currentPlayToken = null;
            state.isBusy = false;
            onError(err);
          }
        }
      };
      speechSynthesis.speak(utter);
      return token;
    }

    if(preMp3Url){
      playMp3(preMp3Url, token, onEnd, onError);
      return token;
    }

    showHuaweiTip();
    state.isBusy = false;
    onError({msg:"本机未找到西班牙语TTS，请下载系统西语语音包"});
    return token;
  }

  function playMp3(mp3Url, token, onEnd, onError) {
    const audio = new Audio(mp3Url);
    state.currentPlayToken.audioEl = audio;
    audio.play().then(()=>{
      audio.onended = ()=>{
        if (state.currentPlayToken?.id === token) {
          state.currentPlayToken = null;
          state.isBusy = false;
          onEnd();
        }
      };
      audio.onerror = (err)=>{
        if (state.currentPlayToken?.id === token) {
          state.currentPlayToken = null;
          state.isBusy = false;
          onError(err);
        }
      };
    }).catch(err=>{
      state.currentPlayToken = null;
      state.isBusy = false;
      onError(err);
    })
  }

  let tipShown = false;
  function showHuaweiTip(){
    if(tipShown) return;
    tipShown = true;
    const tipDom = document.createElement('div');
    tipDom.style = \`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:#222;color:#fff;padding:12px 16px;border-radius:8px;z-index:9999;max-width:90%;font-size:14px\`;
    tipDom.innerText = "🔊华为手机无声提示：设置 → 智慧助手 → 智慧语音，下载西班牙语语音包";
    document.body.appendChild(tipDom);
    setTimeout(()=>tipDom.remove(), 4500);
  }

  // 预留第二批WASM离线TTS钩子，本次不加载模型
  const WASM_TTS = {
    isReady: false,
    init: async ()=>{
      console.log("WASM离线TTS预留入口，暂未启用");
    },
    speak: async (text, token)=>{}
  }

  return {
    playSpanish,
    stopAllAudio,
    detectSpanishVoice,
    WASM_TTS
  }
})();
`;
    document.head.appendChild(coreScript);

    // 自动绑定播放按钮：监听DOM动态新增卡片
    const btnObserver = new MutationObserver(()=>{
        document.querySelectorAll(".lab-play-btn:not([bind-tts])").forEach(btn=>{
            btn.setAttribute("bind-tts", "1");
            btn.addEventListener("click", ()=>{
                const esTxt = btn.dataset.es;
                const mp3Src = btn.dataset.mp3 || null;
                window.NTE_TTS.playSpanish(esTxt, mp3Src, 
                    ()=>{},
                    (err)=>console.warn("TTS播放失败",err)
                );
            })
        })
    });
    btnObserver.observe(document.body, {childList:true,subtree:true});

    // ========= 核心BUG修复：劫持包装原有题库导航函数，切题自动停止音频 =========
    function wrapAudioGuard(funcName){
        if(typeof window[funcName] === "function"){
            const originalFn = window[funcName];
            window[funcName] = function(...args){
                if(window.NTE_TTS) window.NTE_TTS.stopAllAudio();
                return originalFn.apply(this, args);
            }
        }else{
            // 等待全局函数定义完成后再劫持（SPA延迟初始化）
            setTimeout(()=>wrapAudioGuard(funcName),300);
        }
    }
    // 劫持所有题库切换/退出方法
    wrapAudioGuard("nextQ");
    wrapAudioGuard("prevQ");
    wrapAudioGuard("quitQuiz");
    wrapAudioGuard("goHome");

    // 页面关闭/后台：停止音频
    window.addEventListener('pagehide', ()=>{
        if(window.NTE_TTS) window.NTE_TTS.stopAllAudio();
    });

    console.log("✅【FINAL】NTE-TTS注入完成 | 三级TTS + 音频重叠BUG修复已加载");
})();

// ========= iOS Safari 专项补丁 =========
(function iosSafariPatch(){
    // iOS修复：voices加载多次重试（iOS首次打开经常拿不到语音列表）
    let retryVoiceTimer;
    function retryDetectVoices(){
        if(!window.NTE_TTS) return;
        if(!speechSynthesis.getVoices().find(v=>v.lang.startsWith("es"))){
            retryVoiceTimer = setTimeout(retryDetectVoices,800);
        }else{
            clearTimeout(retryVoiceTimer);
        }
    }
    // 页面首次用户点击后，重新刷新语音列表（iOS经典bug）
    document.body.addEventListener("click", function triggerVoicesOnce(){
        speechSynthesis.getVoices();
        document.body.removeEventListener("click", triggerVoicesOnce);
    },{once:true});

    // iOS 修复：Safari pagehide兼容性，visibilitychange兜底
    document.addEventListener("visibilitychange",()=>{
        if(document.hidden && window.NTE_TTS){
            window.NTE_TTS.stopAllAudio();
        }
    })

    // iOS 修复：speechSynthesis页面休眠自动清除，重置状态
    if("speechSynthesis" in window){
        setInterval(()=>{
            if(window.NTE_TTS && speechSynthesis.paused){
                speechSynthesis.cancel();
            }
        },25000);
    }
    console.log("🍎 iOS Safari TTS补丁加载完成");
})();
