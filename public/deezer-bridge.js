/*
 * Deezer JSONP bridge. Loaded only inside a sandboxed iframe (sandbox="allow-scripts", so an opaque
 * origin: no access to the app's storage, tokens or DOM). api.deezer.com has no CORS headers, so
 * its answer is read as JSONP here and handed to the app with postMessage, which validates it.
 * Protocol: parent -> {type:'hc-jsonp', id, name, url}; this page -> {type:'hc-ready'} once,
 * then {type:'hc-jsonp-result', id, ok, data}. The URL must be on api.deezer.com over https and
 * its callback must be the generated name; anything else is refused.
 */
(function () {
  'use strict';
  var ORIGIN = 'https://api.deezer.com/';
  var NAME = /^__hcDeezer[a-z0-9]{1,40}$/;

  function reply(id, ok, data) {
    parent.postMessage({ type: 'hc-jsonp-result', id: id, ok: ok, data: data }, '*');
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var m = event.data;
    if (!m || m.type !== 'hc-jsonp' || typeof m.id !== 'number') return;
    var name = m.name;
    var url;
    try {
      url = new URL(String(m.url));
    } catch {
      return reply(m.id, false);
    }
    if (
      typeof name !== 'string' ||
      !NAME.test(name) ||
      url.href.indexOf(ORIGIN) !== 0 ||
      url.searchParams.get('callback') !== name
    ) {
      return reply(m.id, false);
    }
    var script = document.createElement('script');
    var finished = false;
    function finish(ok, data) {
      if (finished) return;
      finished = true;
      // A late answer finds a no-op instead of a ReferenceError.
      window[name] = function () {};
      script.remove();
      reply(m.id, ok, data);
    }
    window[name] = function (data) {
      finish(true, data);
    };
    script.onerror = function () {
      finish(false);
    };
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = url.href;
    document.head.appendChild(script);
  });

  parent.postMessage({ type: 'hc-ready' }, '*');
})();
