/* Runtime transport. No answers, daily seeds or portrait filenames are bundled here. */
window.ShrekAPI = (() => {
  const given = (window.SHREKDLE_API_URL || '').trim();
  let endpoint = null, invalid = false;
  if (given) {
    try {
      const parsed = new URL(given);
      const loopback = ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
      if ((parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) ||
          parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
        throw new Error('Invalid endpoint');
      }
      endpoint = parsed.origin;
    } catch { invalid = true; }
  }
  const remote = endpoint && endpoint !== location.origin;
  const projectPath = new URL('./', location.href).pathname;
  const storageKey = `shrekdle:session:v1:${projectPath}:${endpoint}`;
  let inMemory = '';
  const readToken = () => {
    try { return localStorage.getItem(storageKey) || inMemory; } catch { return inMemory; }
  };
  function saveToken(token) {
    if (remote && /^[\w-]{43}$/.test(token ?? '')) {
      inMemory = token;
      try { localStorage.setItem(storageKey, token); } catch {}
    }
  }
  const apiURL = path => endpoint ? `${endpoint}/api/${path}` : `api/${path}`;
  const requestOptions = () => ({
    credentials:remote?'omit':'same-origin', cache:'no-store', redirect:'error',
    headers:remote && readToken()?{'X-Shrek-Session':readToken()}:{}
  });
  const failure = () => {
    if (invalid) return new Error('L’adresse du serveur dans jeu-config.js doit être une adresse HTTPS valide.');
    if (!endpoint) return new Error('Serveur de jeu inaccessible. Sur GitHub Pages, renseigne son adresse HTTPS dans jeu-config.js.');
    return new Error('Serveur de jeu inaccessible. Réessaie dans un instant ; le serveur peut être en train de démarrer.');
  };
  const escape = text => String(text ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
  function create(game) {
    async function send(action, fields = {}) {
      if (invalid) throw failure();
      let response, data;
      try {
        const options = requestOptions();
        response = await fetch(apiURL(`${game}/play`), {
          ...options, method:'POST',
          headers:{...options.headers,'Content-Type':'application/json'},
          body:JSON.stringify({action, ...fields})
        });
        data = await response.json();
      } catch {
        throw failure();
      }
      if (!response.ok) throw Object.assign(new Error(data.error || 'Le serveur n’a pas validé la demande.'), {status:response.status});
      saveToken(data.session);
      delete data.session;
      return data;
    }
    async function image(round, guessed) {
      const part = guessed === undefined ? '' : `/${encodeURIComponent(guessed)}`;
      const res = await fetch(apiURL(`image/${game}/${encodeURIComponent(round)}${part}`), requestOptions());
      if (!res.ok) throw new Error('Image indisponible');
      return URL.createObjectURL(await res.blob());
    }
    return {send, image};
  }
  return {create, escape};
})();
