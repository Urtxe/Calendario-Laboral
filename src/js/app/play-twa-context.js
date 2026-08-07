(function (window) {
  "use strict";

  // This marker is added only by the native Play TWA launcher. It controls UI
  // visibility and must never be used as proof of identity or Premium access.
  const PLAY_TWA_QUERY_PARAM = "play_twa";
  const PLAY_TWA_QUERY_VALUE = "1";
  const PLAY_TWA_SESSION_KEY = "balance_laboral_play_twa_session_v1";
  let playTwaActive = false;

  function urlHasPlayTwaMarker(urlLike) {
    try {
      const url = new URL(urlLike, window.location.origin);
      return url.searchParams.get(PLAY_TWA_QUERY_PARAM) === PLAY_TWA_QUERY_VALUE;
    } catch (error) {
      return false;
    }
  }

  function readSessionMarker() {
    try {
      return window.sessionStorage.getItem(PLAY_TWA_SESSION_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function writeSessionMarker() {
    try {
      window.sessionStorage.setItem(PLAY_TWA_SESSION_KEY, "1");
    } catch (error) {
      // A blocked storage area only affects this UI hint; it must not break the app.
    }
  }

  function removeMarkerFromAddressBar() {
    const url = new URL(window.location.href);
    if (url.searchParams.get(PLAY_TWA_QUERY_PARAM) !== PLAY_TWA_QUERY_VALUE) {
      return;
    }

    url.searchParams.delete(PLAY_TWA_QUERY_PARAM);
    const relativeUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", relativeUrl);
  }

  function initialize() {
    const launchedByPlayTwa = urlHasPlayTwaMarker(window.location.href);
    playTwaActive = launchedByPlayTwa || readSessionMarker();

    if (launchedByPlayTwa) {
      writeSessionMarker();
      removeMarkerFromAddressBar();
    }

    return playTwaActive;
  }

  const context = Object.freeze({
    initialize,
    isActive: function () {
      return playTwaActive;
    },
    isMarkedUrl: urlHasPlayTwaMarker,
  });

  window.PlayTwaContext = context;
  window.esContextoPlayTwa = context.isActive;
  initialize();
})(window);
